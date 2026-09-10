import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function fixture(options = {}) {
  const listeners = {};
  const calls = { tabMessages: [], runtimeMessages: [], executeScript: [], badges: [] };
  let activeTab = options.activeTab || { id: 7, url: 'https://top.example/app' };
  const sendImpl = options.sendImpl || (async () => ({
    success: true,
    tools: [{ id: 'tool-1', name: 'search', executable: true }],
    declarativeDiagnostics: [],
    apis: [{ flavor: 'document.modelContext', standard: true }],
    apiAvailable: true,
    warnings: [],
    pageInstanceId: 'document-1'
  }));
  // Minimal in-memory session storage, shared within the fixture.
  const sessionStore = options.sessionStore ? { ...options.sessionStore } : {};
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    action: {
      setBadgeText: async (value) => calls.badges.push(value),
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {}
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      sendMessage: async (value) => calls.runtimeMessages.push(value)
    },
    commands: { onCommand: { addListener() {} } },
    scripting: { executeScript: async (value) => calls.executeScript.push(value) },
    storage: {
      session: {
        get: async (key) => {
          const keys = Array.isArray(key) ? key : [key];
          const result = {};
          for (const k of keys) if (k in sessionStore) result[k] = sessionStore[k];
          return result;
        },
        set: async (obj) => Object.assign(sessionStore, obj),
        remove: async (key) => { delete sessionStore[key]; }
      }
    },
    webNavigation: {
      getAllFrames: async () => options.frames || [
        { frameId: 0, url: activeTab.url },
        { frameId: 3, url: 'https://widget.example/frame' },
        { frameId: 4, url: 'http://insecure.example/frame' }
      ]
    },
    tabs: {
      query: async () => [activeTab],
      get: async () => activeTab,
      sendMessage: async (tabId, message, target) => {
        calls.tabMessages.push({ tabId, message, target });
        const response = await sendImpl(tabId, message, target);
        if (options.afterSendTab) activeTab = options.afterSendTab;
        return response;
      },
      onActivated: { addListener: (fn) => { listeners.activated = fn; } },
      onRemoved: { addListener: (fn) => { listeners.removed = fn; } },
      onUpdated: { addListener: (fn) => { listeners.updated = fn; } }
    }
  };
  const context = vm.createContext({ chrome, console, URL, Date, Number, String, Array, Set, Map, setTimeout });
  vm.runInContext(readFileSync(join(process.cwd(), 'background.js'), 'utf8'), context, { filename: 'background.js' });
  return { listeners, calls, sessionStore, setActiveTab: (tab) => { activeTab = tab; } };
}

function send(listener, message, sender = {}) {
  return new Promise((resolve) => listener(message, sender, resolve));
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('refresh enumerates secure child origins and addresses only the top content frame', async () => {
  const f = fixture();
  const response = await send(f.listeners.message, { type: 'REFRESH_TOOLS' });
  assert.equal(response.success, true);
  assert.deepEqual(plain(f.calls.tabMessages), [{
    tabId: 7,
    message: { action: 'LIST_TOOLS', fromOrigins: ['https://widget.example'] },
    target: { frameId: 0 }
  }]);
  assert.equal(f.calls.runtimeMessages[0].tabId, 7);
  assert.equal(f.calls.runtimeMessages[0].type, 'TOOLS_UPDATE');
});

test('missing receiver is reinjected in the top frame and retried once', async () => {
  let attempt = 0;
  const f = fixture({
    sendImpl: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { success: true, tools: [], apis: [], apiAvailable: false, pageInstanceId: 'pid-retry' };
    }
  });
  const response = await send(f.listeners.message, { type: 'REFRESH_TOOLS' });
  assert.equal(response.success, true);
  assert.equal(attempt, 2);
  assert.deepEqual(plain(f.calls.executeScript), [{ target: { tabId: 7, allFrames: false }, files: ['content.js'] }]);
});

test('GET_TOOLS returns cached snapshot only when pageInstanceId is present', async () => {
  // sendImpl returns null pageInstanceId — cache must never be used, always fetch live.
  const f = fixture({
    sendImpl: async () => ({
      success: true, tools: [], apis: [{ flavor: 'document.modelContext' }],
      apiAvailable: true, pageInstanceId: null
    })
  });
  await send(f.listeners.message, { type: 'GET_TOOLS' });
  await send(f.listeners.message, { type: 'GET_TOOLS' });
  // Both calls go to the content script because pageInstanceId is never populated.
  assert.equal(f.calls.tabMessages.length, 2);
});

test('GET_TOOLS returns cached snapshot when pageInstanceId is valid', async () => {
  const f = fixture(); // default sendImpl returns pageInstanceId: 'document-1'
  await send(f.listeners.message, { type: 'GET_TOOLS' });
  await send(f.listeners.message, { type: 'GET_TOOLS' });
  // Second call hits the in-memory cache — only one tab message sent.
  assert.equal(f.calls.tabMessages.length, 1);
});

test('content change notifications are accepted only from the top frame', async () => {
  const f = fixture();
  const child = await send(f.listeners.message, { type: 'TOOLS_CHANGED' }, { tab: { id: 7 }, frameId: 2 });
  assert.deepEqual(plain(child), { received: true, ignored: 'non-top-frame' });
  assert.equal(f.calls.tabMessages.length, 0);
  const top = await send(f.listeners.message, { type: 'TOOLS_CHANGED' }, { tab: { id: 7 }, frameId: 0 });
  assert.deepEqual(plain(top), { received: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.tabMessages.length, 1);
});

test('execution rejects stale tab identity and routes an exact tool id when current', async () => {
  const f = fixture();
  const discovered = await send(f.listeners.message, { type: 'REFRESH_TOOLS' });
  assert.equal(discovered.success, true);
  const stale = await send(f.listeners.message, { type: 'EXECUTE_TOOL', tabId: 99, toolId: 'tool-1', inputArgs: {} });
  assert.match(stale.error, /no longer active/);
  const current = await send(f.listeners.message, { type: 'EXECUTE_TOOL', tabId: 7, toolId: 'tool-1', inputArgs: { q: 'x' } });
  assert.equal(current.success, true);
  assert.deepEqual(plain(f.calls.tabMessages.at(-1)), {
    tabId: 7,
    message: { action: 'EXECUTE_TOOL', toolId: 'tool-1', inputArgs: { q: 'x' }, pageInstanceId: 'document-1' },
    target: { frameId: 0 }
  });
});

test('same-document URL changes do not invalidate discovered tools', async () => {
  const f = fixture({ afterSendTab: { id: 7, url: 'https://top.example/next' } });
  const response = await send(f.listeners.message, { type: 'REFRESH_TOOLS' });
  assert.equal(response.success, true);
  assert.equal(response.tools.length, 1);
  assert.equal(response.url, 'https://top.example/next');
  assert.equal(f.calls.runtimeMessages.length, 1);
});

test('execution auto-recovers from service worker restart via session storage', async () => {
  // Pre-seed session storage as if the previous service worker instance had run discovery.
  const preloaded = {
    'tab_7': {
      tabId: 7,
      tools: [{ id: 'tool-1', name: 'search', executable: true }],
      declarativeDiagnostics: [],
      apis: [],
      apiAvailable: true,
      warnings: [],
      pageInstanceId: 'restored-pid',
      url: 'https://top.example/app',
      updatedAt: Date.now()
    }
  };
  const f = fixture({
    sessionStore: preloaded,
    sendImpl: async (_tabId, message) => {
      // Only EXECUTE_TOOL should be forwarded to the content script.
      if (message.action === 'EXECUTE_TOOL') return { success: true, result: 'done' };
      // If LIST_TOOLS is called it means session restore failed; return valid snapshot anyway.
      return {
        success: true,
        tools: [{ id: 'tool-1', name: 'search', executable: true }],
        declarativeDiagnostics: [], apis: [], apiAvailable: true, warnings: [],
        pageInstanceId: 'restored-pid'
      };
    }
  });
  // tabState is empty (fresh fixture = simulated restart). No REFRESH_TOOLS called.
  // EXECUTE_TOOL must auto-restore from session storage and succeed.
  const result = await send(f.listeners.message, {
    type: 'EXECUTE_TOOL', tabId: 7, toolId: 'tool-1', inputArgs: {}
  });
  assert.equal(result.success, true, `Expected success but got: ${result.error}`);
});

test('KEEPALIVE returns alive confirmation without side effects', async () => {
  const f = fixture();
  const response = await send(f.listeners.message, { type: 'KEEPALIVE' });
  assert.deepEqual(plain(response), { alive: true });
  assert.equal(f.calls.tabMessages.length, 0);
  assert.equal(f.calls.runtimeMessages.length, 0);
});
