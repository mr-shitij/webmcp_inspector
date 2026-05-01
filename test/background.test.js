import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function createMockChrome(overrides = {}) {
  const listeners = {
    runtimeMessage: null,
    tabActivated: null,
    tabRemoved: null,
    tabUpdated: null
  };
  const calls = {
    badgeText: [],
    executeScript: [],
    runtimeMessages: [],
    tabMessages: []
  };

  const activeTab = overrides.activeTab || { id: 123, url: 'https://example.com/app' };
  const sendMessageImpl = overrides.sendMessageImpl || (async () => ({
    success: true,
    tools: [{ name: 'top_tool' }],
    url: activeTab.url
  }));

  const chrome = {
    sidePanel: {
      setPanelBehavior: async () => undefined
    },
    action: {
      setBadgeText: async (payload) => {
        calls.badgeText.push(payload);
      },
      setBadgeBackgroundColor: async () => undefined,
      setBadgeTextColor: async () => undefined
    },
    commands: {
      onCommand: {
        addListener: () => undefined
      }
    },
    runtime: {
      onInstalled: {
        addListener: () => undefined
      },
      onMessage: {
        addListener: (listener) => {
          listeners.runtimeMessage = listener;
        }
      },
      sendMessage: async (payload) => {
        calls.runtimeMessages.push(payload);
      }
    },
    scripting: {
      executeScript: async (payload) => {
        calls.executeScript.push(payload);
      }
    },
    tabs: {
      query: async () => [activeTab],
      get: async () => activeTab,
      sendMessage: async (tabId, payload, options) => {
        calls.tabMessages.push({ tabId, payload, options });
        return sendMessageImpl(tabId, payload, options);
      },
      onActivated: {
        addListener: (listener) => {
          listeners.tabActivated = listener;
        }
      },
      onRemoved: {
        addListener: (listener) => {
          listeners.tabRemoved = listener;
        }
      },
      onUpdated: {
        addListener: (listener) => {
          listeners.tabUpdated = listener;
        }
      }
    }
  };

  return { chrome, listeners, calls };
}

function loadBackground(overrides) {
  const fixture = createMockChrome(overrides);
  const code = readFileSync(join(process.cwd(), 'background.js'), 'utf8');
  const context = vm.createContext({
    chrome: fixture.chrome,
    console,
    setTimeout,
    Date,
    String,
    Array,
    RegExp
  });

  vm.runInContext(code, context, { filename: 'background.js' });
  assert.equal(typeof fixture.listeners.runtimeMessage, 'function');

  return fixture;
}

function sendRuntimeMessage(listener, message, sender = {}) {
  return new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('refresh requests tools from the top frame only', async () => {
  const fixture = loadBackground();

  const response = await sendRuntimeMessage(fixture.listeners.runtimeMessage, {
    type: 'REFRESH_TOOLS'
  });

  assert.equal(response.success, true);
  assert.deepEqual(plain(fixture.calls.tabMessages), [
    {
      tabId: 123,
      payload: { action: 'LIST_TOOLS' },
      options: { frameId: 0 }
    }
  ]);
});

test('auto-injects content script into the top frame only', async () => {
  let attempts = 0;
  const fixture = loadBackground({
    sendMessageImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return { success: true, tools: [{ name: 'top_tool' }], url: 'https://example.com/app' };
    }
  });

  const response = await sendRuntimeMessage(fixture.listeners.runtimeMessage, {
    type: 'REFRESH_TOOLS'
  });

  assert.equal(response.success, true);
  assert.equal(attempts, 2);
  assert.deepEqual(plain(fixture.calls.executeScript), [
    {
      target: { tabId: 123, allFrames: false },
      files: ['content.js']
    }
  ]);
  assert.deepEqual(plain(fixture.calls.tabMessages.map((call) => call.options)), [
    { frameId: 0 },
    { frameId: 0 }
  ]);
});

test('ignores tool updates from non-top frames', async () => {
  const fixture = loadBackground();

  const topFrameResponse = await sendRuntimeMessage(
    fixture.listeners.runtimeMessage,
    { type: 'TOOLS_LIST', tools: [{ name: 'top_tool' }], url: 'https://example.com/app' },
    { tab: { id: 123, url: 'https://example.com/app' }, frameId: 0 }
  );

  const childFrameResponse = await sendRuntimeMessage(
    fixture.listeners.runtimeMessage,
    { type: 'TOOLS_LIST', tools: [], url: 'https://example.com/frame' },
    { tab: { id: 123, url: 'https://example.com/app' }, frameId: 1 }
  );

  assert.deepEqual(plain(topFrameResponse), { received: true });
  assert.deepEqual(plain(childFrameResponse), { received: true, ignored: 'non-top-frame' });
  assert.deepEqual(plain(fixture.calls.runtimeMessages), [
    {
      type: 'TOOLS_UPDATE',
      tools: [{ name: 'top_tool' }],
      url: 'https://example.com/app',
      updatedAt: fixture.calls.runtimeMessages[0].updatedAt
    }
  ]);
  assert.deepEqual(plain(fixture.calls.badgeText), [{ text: '1', tabId: 123 }]);
});
