import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function createEnvironment(options = {}) {
  const sentMessages = [];
  const listeners = [];
  let mutationCallback = null;
  const mockWindow = { __webmcpInspectorInjected: false, addEventListener() {}, frames: [] };
  mockWindow.frames = options.frames || [];
  mockWindow.top = options.topFrame === false ? {} : mockWindow;
  const document = {
    modelContext: options.documentModelContext || null,
    documentElement: options.observeMutations ? {} : null,
    querySelectorAll: options.querySelectorAll || (() => [])
  };
  class MockMutationObserver {
    constructor(callback) { mutationCallback = callback; }
    observe() {}
  }
  const context = vm.createContext({
    window: mockWindow,
    document,
    navigator: {
      modelContextTesting: options.testingModelContext || null
    },
    chrome: {
      runtime: {
        sendMessage: async (message) => sentMessages.push(message),
        onMessage: { addListener: (listener) => listeners.push(listener) }
      }
    },
    console,
    URL,
    location: { href: 'https://example.com/page', origin: 'https://example.com' },
    Date,
    Math,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    MutationObserver: options.observeMutations ? MockMutationObserver : undefined,
    WeakSet,
    Set,
    Map
  });
  vm.runInContext(readFileSync(join(process.cwd(), 'content.js'), 'utf8'), context, { filename: 'content.js' });
  return { listeners, sentMessages, triggerMutations: (mutations) => mutationCallback?.(mutations) };
}

function send(listener, message) {
  return new Promise((resolve) => listener(message, {}, resolve));
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('standards discovery passes allowed descendant origins and retains identity metadata', async () => {
  const getToolsCalls = [];
  const api = {
    getTools: async (options) => {
      getToolsCalls.push(options);
      return [{ name: 'search.flights', title: 'Flight search', description: 'Search', inputSchema: { type: 'object' }, origin: 'https://example.com' }];
    },
    executeTool: async () => null,
    addEventListener() {}
  };
  const env = createEnvironment({ documentModelContext: api });
  const response = await send(env.listeners[0], { action: 'LIST_TOOLS', fromOrigins: ['https://widget.example', 'http://insecure.example'] });
  assert.equal(response.success, true);
  assert.deepEqual(plain(getToolsCalls), [{ fromOrigins: ['https://widget.example'] }]);
  assert.equal(response.apis[0].flavor, 'document.modelContext');
  assert.equal(response.apis[0].standard, true);
  assert.equal(response.tools[0].name, 'search.flights');
  assert.equal(response.tools[0].origin, 'https://example.com');
  assert.equal(response.tools[0].framePath, 'top');
  assert.match(response.tools[0].id, /^document\.modelContext\|/);
});

test('testing compatibility tools complement but do not shadow standard tools', async () => {
  const env = createEnvironment({
    documentModelContext: { getTools: async () => [{ name: 'same', inputSchema: {} }], executeTool() {}, addEventListener() {} },
    testingModelContext: { listTools: async () => [{ name: 'same', inputSchema: '{}' }, { name: 'compat-only', inputSchema: '{}' }], executeTool() {} }
  });
  const response = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  assert.deepEqual(plain(response.tools.map((tool) => tool.name)), ['same', 'compat-only']);
  assert.equal(response.tools[0].standardsCompliant, true);
  assert.equal(response.tools[1].apiFlavor, 'navigator.modelContextTesting');
  assert.equal(response.apis.length, 2);
});

test('testing compatibility execution uses exact selected identity and JSON-string arguments', async () => {
  const calls = [];
  const env = createEnvironment({
    testingModelContext: {
      listTools: () => [{ name: 'searchFlights', inputSchema: '{}' }],
      executeTool: async (...args) => { calls.push(args); return 'ok'; }
    }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  const response = await send(env.listeners[0], { action: 'EXECUTE_TOOL', toolId: listed.tools[0].id, inputArgs: { origin: 'LON' }, pageInstanceId: listed.pageInstanceId });
  assert.equal(response.success, true);
  assert.deepEqual(plain(calls), [['searchFlights', '{"origin":"LON"}']]);
});

test('standards execution passes the RegisteredTool object and does not fall back by name', async () => {
  const rawTool = { name: 'calculate', inputSchema: { type: 'object' } };
  const calls = [];
  const env = createEnvironment({
    documentModelContext: {
      getTools: async () => [rawTool],
      executeTool: async (...args) => { calls.push(args); return { answer: 42 }; }
    }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  const input = { x: 2 };
  const response = await send(env.listeners[0], { action: 'EXECUTE_TOOL', toolId: listed.tools[0].id, inputArgs: input, pageInstanceId: listed.pageInstanceId });
  assert.equal(response.success, true);
  assert.equal(calls[0][0], rawTool);
  assert.deepEqual(plain(calls[0][1]), input);
});

test('same-named tools in different frames receive distinct executable identities', async () => {
  const child = { frames: [] };
  const env = createEnvironment({
    frames: [child],
    documentModelContext: {
      getTools: async () => [
        { name: 'save', origin: 'https://example.com', inputSchema: {} },
        { name: 'save', origin: 'https://widget.example', window: child, inputSchema: {} }
      ],
      executeTool() {}
    }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  assert.equal(listed.tools[0].framePath, 'top');
  assert.equal(listed.tools[1].framePath, 'top.0');
  assert.notEqual(listed.tools[0].id, listed.tools[1].id);
});

test('standards execution retries with JSON only for a browser string-contract mismatch', async () => {
  const calls = [];
  const rawTool = { name: 'string-contract-browser', inputSchema: {} };
  const env = createEnvironment({
    documentModelContext: {
      getTools: async () => [rawTool],
      executeTool: async (...args) => {
        calls.push(args);
        if (typeof args[1] !== 'string') throw new TypeError("parameter 2 is not of type 'DOMString'");
        return 'ok';
      }
    }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  const response = await send(env.listeners[0], { action: 'EXECUTE_TOOL', toolId: listed.tools[0].id, inputArgs: { value: 1 }, pageInstanceId: listed.pageInstanceId });
  assert.equal(response.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], '{"value":1}');
});

test('standards execution handles Chromium UnknownError for object arguments', async () => {
  const calls = [];
  const rawTool = { name: 'searchFlights', inputSchema: { type: 'object' } };
  const env = createEnvironment({
    documentModelContext: {
      getTools: async () => [rawTool],
      executeTool: async (...args) => {
        calls.push(args);
        if (typeof args[1] !== 'string') {
          const error = new Error('Failed to parse input arguments');
          error.name = 'UnknownError';
          throw error;
        }
        return '{"flights":[]}';
      }
    }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  const response = await send(env.listeners[0], {
    action: 'EXECUTE_TOOL',
    toolId: listed.tools[0].id,
    inputArgs: { origin: 'SFO', destination: 'LAX' },
    pageInstanceId: listed.pageInstanceId
  });
  assert.equal(response.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], '{"origin":"SFO","destination":"LAX"}');
});

test('invalid schemas are reported and made non-executable', async () => {
  const env = createEnvironment({
    testingModelContext: { listTools: () => [{ name: 'broken', inputSchema: '{bad' }], executeTool() {} }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  assert.equal(listed.tools[0].inputSchema, null);
  assert.match(listed.tools[0].schemaError, /Invalid JSON inputSchema/);
  assert.equal(listed.tools[0].executable, false);
  const response = await send(env.listeners[0], { action: 'EXECUTE_TOOL', toolId: listed.tools[0].id, inputArgs: {}, pageInstanceId: listed.pageInstanceId });
  assert.equal(response.success, false);
});

test('execution rejects a RegisteredTool cached by a previous document', async () => {
  const env = createEnvironment({
    documentModelContext: { getTools: async () => [{ name: 'save', inputSchema: {} }], executeTool() {} }
  });
  const listed = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  const response = await send(env.listeners[0], {
    action: 'EXECUTE_TOOL',
    toolId: listed.tools[0].id,
    inputArgs: {},
    pageInstanceId: 'previous-document'
  });
  assert.equal(response.success, false);
  assert.match(response.error, /document changed since discovery/i);
});

test('declarative markup is returned separately as non-executable diagnostics', async () => {
  const form = {
    getAttribute: (name) => ({ toolname: 'powerCalc', tooldescription: 'Power' }[name] || null),
    hasAttribute: (name) => name === 'toolautosubmit',
    elements: [{ name: 'base', tagName: 'INPUT', type: 'number', required: true, getAttribute: () => null }]
  };
  const env = createEnvironment({ querySelectorAll: () => [form] });
  const response = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  assert.equal(response.tools.length, 0);
  assert.equal(response.declarativeDiagnostics.length, 1);
  assert.equal(response.declarativeDiagnostics[0].executable, false);
  assert.equal(response.declarativeDiagnostics[0].autoSubmit, true);
});

test('browser-exposed declarative tools are executable and are not duplicated by diagnostics', async () => {
  const form = {
    getAttribute: (name) => ({ toolname: 'search_location', tooldescription: 'Search' }[name] || null),
    hasAttribute: () => true,
    elements: []
  };
  const env = createEnvironment({
    documentModelContext: {
      getTools: async () => [{ name: 'search_location', description: 'Search', inputSchema: {}, origin: 'https://example.com' }],
      executeTool() {}
    },
    querySelectorAll: () => [form]
  });
  const response = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  assert.equal(response.tools.length, 1);
  assert.equal(response.tools[0].type, 'declarative');
  assert.equal(response.tools[0].executable, true);
  assert.equal(response.declarativeDiagnostics.length, 0);
});

test('DOM observer ignores unrelated app rendering and debounces declarative changes', async () => {
  const env = createEnvironment({ observeMutations: true });
  const initialMessages = env.sentMessages.length;
  const unrelated = { matches: () => false, closest: () => null };
  env.triggerMutations([{ type: 'childList', target: unrelated, addedNodes: [], removedNodes: [] }]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(env.sentMessages.length, initialMessages);

  const formControl = { matches: () => false, closest: () => ({}) };
  env.triggerMutations([{ type: 'attributes', target: formControl, attributeName: 'required' }]);
  env.triggerMutations([{ type: 'attributes', target: formControl, attributeName: 'required' }]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(env.sentMessages.length, initialMessages + 1);
  assert.equal(env.sentMessages.at(-1).type, 'TOOLS_CHANGED');
});

test('non-top-frame bridge refuses authoritative discovery', async () => {
  const env = createEnvironment({ topFrame: false, testingModelContext: { listTools: () => [{ name: 'child' }] } });
  const response = await send(env.listeners[0], { action: 'LIST_TOOLS' });
  assert.equal(response.ignored, 'non-top-frame');
  assert.equal(response.tools.length, 0);
});
