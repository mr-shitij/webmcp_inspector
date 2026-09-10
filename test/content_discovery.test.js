import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import GeminiProvider from '../js/ai/providers/GeminiProvider.js';
import AnthropicProvider from '../js/ai/providers/AnthropicProvider.js';

function createMockContentEnv(options = {}) {
  const sentMessages = [];
  const registeredListeners = [];

  const mockChrome = {
    runtime: {
      sendMessage: async (msg) => {
        sentMessages.push(msg);
      },
      onMessage: {
        addListener: (listener) => {
          registeredListeners.push(listener);
        }
      }
    }
  };

  const mockDocument = {
    modelContext: options.documentModelContext || null,
    querySelector: options.querySelector || (() => null),
    querySelectorAll: options.querySelectorAll || (() => [])
  };

  const mockNavigator = {
    modelContextTesting: options.navigatorModelContextTesting || null,
    modelContext: options.navigatorModelContext || null
  };

  const mockWindow = {
    __webmcpInspectorInjected: false,
    top: options.isTopFrame !== false ? null : { different: true },
    addEventListener: () => {}
  };
  if (options.isTopFrame !== false) {
    mockWindow.top = mockWindow;
  }

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    navigator: mockNavigator,
    chrome: mockChrome,
    console,
    Date,
    String,
    Array,
    Object,
    JSON,
    Promise,
    WeakSet,
    Set,
    Map,
    Event: class { constructor(type) { this.type = type; } },
    location: { href: 'https://example.com/page' },
    setTimeout,
    clearTimeout
  });

  const code = readFileSync(join(process.cwd(), 'content.js'), 'utf8');
  vm.runInContext(code, context, { filename: 'content.js' });

  return { context, sentMessages, registeredListeners };
}

test('content.js discovers tools via modern document.modelContext.getTools()', async () => {
  const mockTools = [
    {
      name: 'addNumbers',
      description: 'Adds two numbers together',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } }
      }
    }
  ];

  const env = createMockContentEnv({
    documentModelContext: {
      getTools: async () => mockTools,
      addEventListener: () => {}
    }
  });

  assert.equal(env.registeredListeners.length, 1);
  const messageHandler = env.registeredListeners[0];

  const response = await new Promise((resolve) => {
    messageHandler({ action: 'LIST_TOOLS' }, {}, resolve);
  });

  assert.equal(response.success, true);
  assert.equal(response.api, 'document.modelContext');
  assert.equal(response.tools.length, 1);
  assert.equal(response.tools[0].name, 'addNumbers');
  assert.equal(response.tools[0].description, 'Adds two numbers together');
});

test('content.js falls back to legacy navigator.modelContextTesting.listTools()', async () => {
  const mockLegacyTools = [
    {
      name: 'legacySearch',
      description: 'Legacy search tool',
      inputSchema: '{"type":"object","properties":{"q":{"type":"string"}}}'
    }
  ];

  const env = createMockContentEnv({
    navigatorModelContextTesting: {
      listTools: () => mockLegacyTools,
      registerToolsChangedCallback: () => {}
    }
  });

  const messageHandler = env.registeredListeners[0];
  const response = await new Promise((resolve) => {
    messageHandler({ action: 'LIST_TOOLS' }, {}, resolve);
  });

  assert.equal(response.success, true);
  assert.equal(response.api, 'testing');
  assert.equal(response.tools.length, 1);
  assert.equal(response.tools[0].name, 'legacySearch');
  assert.equal(response.tools[0].inputSchema.type, 'object');
});

test('content.js scans DOM for declarative forms as fallback or complement', async () => {
  const mockForm = {
    getAttribute: (attr) => {
      if (attr === 'toolname') return 'powerCalc';
      if (attr === 'tooldescription') return 'Calculates power of 2';
      return null;
    },
    elements: [
      {
        getAttribute: (attr) => (attr === 'toolparamname' ? 'base' : null),
        name: 'base',
        tagName: 'INPUT',
        type: 'number',
        required: true
      }
    ]
  };

  const env = createMockContentEnv({
    documentModelContext: null,
    navigatorModelContextTesting: null,
    querySelectorAll: (selector) => {
      if (selector.includes('form[toolname]')) return [mockForm];
      return [];
    }
  });

  const messageHandler = env.registeredListeners[0];
  const response = await new Promise((resolve) => {
    messageHandler({ action: 'LIST_TOOLS' }, {}, resolve);
  });

  assert.equal(response.success, true);
  assert.equal(response.tools.length, 1);
  assert.equal(response.tools[0].name, 'powerCalc');
  assert.equal(response.tools[0].type, 'declarative');
  assert.equal(response.tools[0].inputSchema.properties.base.type, 'number');
  assert.deepEqual(JSON.parse(JSON.stringify(response.tools[0].inputSchema.required)), ['base']);
});

test('GeminiProvider coalesces consecutive user or model turns to satisfy Gemini API requirements', () => {
  const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.5-flash' });

  const inputMessages = [
    { role: 'user', content: 'What tools are available?' },
    { role: 'user', content: 'Also can you calculate something?' },
    { role: 'assistant', content: 'I found calcTool.' },
    { role: 'assistant', content: 'Let me run it for you.' },
    { role: 'user', content: 'Tool results: result = 42' }
  ];

  const formatted = provider.formatMessages(inputMessages);

  // Consecutive user turns must be merged into 1 user turn with multiple parts
  // Consecutive assistant turns must be merged into 1 model turn with multiple parts
  assert.equal(formatted.length, 3);
  assert.equal(formatted[0].role, 'user');
  assert.equal(formatted[0].parts.length, 2);
  assert.equal(formatted[0].parts[0].text, 'What tools are available?');
  assert.equal(formatted[0].parts[1].text, 'Also can you calculate something?');

  assert.equal(formatted[1].role, 'model');
  assert.equal(formatted[1].parts.length, 2);

  assert.equal(formatted[2].role, 'user');
  assert.equal(formatted[2].parts.length, 1);
});

test('AnthropicProvider coalesces consecutive turns to prevent roles must alternate error', () => {
  const provider = new AnthropicProvider({ apiKey: 'test-key', model: 'claude-sonnet-4-20250514' });

  const inputMessages = [
    { role: 'user', content: 'First message' },
    { role: 'user', content: 'Second message' },
    { role: 'assistant', content: '[Calling tool: search]' },
    { role: 'user', content: 'Tool call results: found 1 item' }
  ];

  const result = provider.formatMessages(inputMessages);

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content, 'First message\n\nSecond message');
  assert.equal(result.messages[1].role, 'assistant');
  assert.equal(result.messages[2].role, 'user');
});
