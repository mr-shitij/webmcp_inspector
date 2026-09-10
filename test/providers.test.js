import assert from 'node:assert/strict';
import test from 'node:test';

import OpenAIProvider from '../js/ai/providers/OpenAIProvider.js';
import AnthropicProvider from '../js/ai/providers/AnthropicProvider.js';
import GeminiProvider from '../js/ai/providers/GeminiProvider.js';
import OllamaProvider from '../js/ai/providers/OllamaProvider.js';
import { toGeminiSchema } from '../js/ai/utils/toolSchemas.js';

const TOOL = {
  id: 'standard|origin|top|flight.search|0',
  name: 'flight.search',
  description: 'Search flights',
  inputSchema: { type: 'object', properties: { passengers: { type: 'integer', minimum: 1 } }, required: ['passengers'] },
  executable: true
};

test('OpenAI preserves assistant tool calls and matching tool result ids', () => {
  const provider = new OpenAIProvider({});
  const formattedTools = provider.formatTools([TOOL]);
  const providerName = formattedTools[0].function.name;
  assert.equal(providerName, 'flight_search');
  const parsed = provider.parseResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', function: { name: providerName, arguments: '{"passengers":2}' } }] } }] });
  assert.equal(parsed.toolCalls[0].toolId, TOOL.id);
  const messages = provider.formatMessages([
    parsed.assistantMessage,
    { role: 'tool', toolCallId: 'call_1', name: TOOL.name, providerName, content: { flights: 3 }, untrusted: true }
  ]);
  assert.equal(messages[0].tool_calls[0].id, 'call_1');
  assert.equal(messages[1].role, 'tool');
  assert.equal(messages[1].tool_call_id, 'call_1');
  assert.match(messages[1].content, /UNTRUSTED WEBMCP TOOL OUTPUT/);
});

test('provider adapters surface malformed tool arguments instead of replacing them', () => {
  const provider = new OpenAIProvider({});
  provider.formatTools([TOOL]);
  const parsed = provider.parseResponse({ choices: [{ message: { tool_calls: [{ id: 'bad', function: { name: 'flight_search', arguments: '{bad' } }] } }] });
  assert.equal(parsed.toolCalls[0].args, null);
  assert.match(parsed.toolCalls[0].parseError, /Invalid tool arguments/);
});

test('OpenAI never removes tools as an automatic compatibility fallback', () => {
  const provider = new OpenAIProvider({});
  const body = { model: 'example', messages: [], tools: [{ type: 'function' }], tool_choice: 'auto' };
  assert.equal(provider.adjustUnsupportedPayload(body, "Unsupported parameter: 'tools'"), null);
  assert.equal(provider.adjustUnsupportedPayload(body, "Unsupported parameter: 'tool_choice'"), null);
});

test('Anthropic preserves tool_use ids and emits immediate tool_result blocks', () => {
  const provider = new AnthropicProvider({});
  provider.formatTools([TOOL]);
  const parsed = provider.parseResponse({ content: [{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'toolu_1', name: 'flight_search', input: { passengers: 1 } }] });
  const formatted = provider.formatMessages([
    { role: 'user', content: 'Find a flight' },
    parsed.assistantMessage,
    { role: 'tool', toolCallId: 'toolu_1', name: TOOL.name, providerName: 'flight_search', content: { ok: true } }
  ]);
  assert.equal(formatted.messages[1].content[1].id, 'toolu_1');
  assert.equal(formatted.messages[2].content[0].tool_use_id, 'toolu_1');
});

test('Gemini preserves raw thought-signature parts across function responses', () => {
  const provider = new GeminiProvider({});
  provider.formatTools([TOOL]);
  const content = {
    role: 'model',
    parts: [{ functionCall: { id: 'gem_1', name: 'flight_search', args: { passengers: 1 } }, thoughtSignature: 'opaque-signature' }]
  };
  const parsed = provider.parseResponse({ candidates: [{ content }] });
  const formatted = provider.formatMessages([
    parsed.assistantMessage,
    { role: 'tool', toolCallId: 'gem_1', name: TOOL.name, providerName: 'flight_search', content: { ok: true }, untrusted: true }
  ]);
  assert.equal(formatted[0], content);
  assert.equal(formatted[0].parts[0].thoughtSignature, 'opaque-signature');
  assert.equal(formatted[1].parts[0].functionResponse.id, 'gem_1');
});

test('Gemini schema conversion keeps validation constraints', () => {
  const schema = toGeminiSchema({ type: 'object', properties: { code: { type: 'string', pattern: '^[A-Z]+$', minLength: 3 } }, required: ['code'] });
  assert.equal(schema.properties.code.pattern, '^[A-Z]+$');
  assert.equal(schema.properties.code.minLength, 3);
  assert.deepEqual(schema.required, ['code']);
});

test('Gemini sends API keys in a header rather than the URL query string', async () => {
  const provider = new GeminiProvider({ apiKey: 'header-secret', model: 'gemini-test', maxTokens: 10, temperature: 0 });
  let request;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }) };
  };
  try {
    const response = await provider.sendMessage([{ role: 'user', content: 'hello' }], []);
    assert.equal(response.text, 'ok');
    assert.doesNotMatch(request.url, /header-secret|[?&]key=/);
    assert.equal(request.options.headers['x-goog-api-key'], 'header-secret');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Ollama accepts loopback endpoints and rejects arbitrary network targets', () => {
  assert.equal(new OllamaProvider({ serverUrl: 'http://127.0.0.1:11434', model: 'qwen' }).isConfigured(), true);
  assert.equal(new OllamaProvider({ serverUrl: 'http://192.168.1.5:11434', model: 'qwen' }).isConfigured(), false);
  assert.throws(() => new OllamaProvider({ serverUrl: 'http://192.168.1.5:11434' }).getBaseUrl(), /loopback/);
});
