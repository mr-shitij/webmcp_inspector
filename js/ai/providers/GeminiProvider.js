/**
 * WebMCP Inspector - Google Gemini Provider
 */

import AIProvider from '../AIProvider.js';
import { toGeminiSchema } from '../utils/toolSchemas.js';

class GeminiProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'Google Gemini';
    this.id = 'gemini';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  async testConnection() {
    try {
      if (!this.config.apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      const response = await fetch(`${this.baseUrl}/models`, { headers: { 'x-goog-api-key': this.config.apiKey } });

      if (!response.ok) {
        const error = await response.json();
        return { 
          success: false, 
          error: error.error?.message || `HTTP ${response.status}` 
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getModels() {
    try {
      if (!this.config.apiKey) return [];
      const response = await fetch(`${this.baseUrl}/models`, { headers: { 'x-goog-api-key': this.config.apiKey } });
      if (!response.ok) return [];

      const data = await response.json();
      const models = Array.isArray(data.models) ? data.models : [];

      return models
        .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
        .map((model) => ({
          id: String(model.name || '').replace(/^models\//, ''),
          name: String(model.displayName || model.name || '').replace(/^models\//, ''),
          description: model.description || ''
        }))
        .filter((model) => model.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  formatTools(tools) {
    return this.prepareTools(tools).map(({ providerName, description, schema }) => ({
      name: providerName,
      description,
      parameters: toGeminiSchema(schema)
    }));
  }

  formatMessages(messages) {
    const formatted = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'assistant') {
        if (msg.providerData?.geminiContent) formatted.push(msg.providerData.geminiContent);
        else formatted.push({ role: 'model', parts: [
          ...(msg.content ? [{ text: msg.content }] : []),
          ...(msg.toolCalls || []).map((call) => ({ functionCall: { id: call.id, name: call.providerName || call.name, args: call.args || {} } }))
        ] });
      } else if (msg.role === 'tool') {
        const response = { output: this.toolResultText(msg), isError: Boolean(msg.isError) };
        const part = { functionResponse: { id: msg.toolCallId, name: msg.providerName || msg.name, response } };
        if (formatted.at(-1)?.role === 'user') formatted.at(-1).parts.push(part);
        else formatted.push({ role: 'user', parts: [part] });
      } else {
        const part = { text: String(msg.content || '') };
        if (formatted.at(-1)?.role === 'user') formatted.at(-1).parts.push(part);
        else formatted.push({ role: 'user', parts: [part] });
      }
    }

    return formatted;
  }

  async sendMessage(messages, tools = []) {
    try {
      const url = `${this.baseUrl}/models/${this.config.model}:generateContent`;
      
      const body = {
        contents: this.formatMessages(messages),
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens
        }
      };
      const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
      if (system) body.systemInstruction = { parts: [{ text: system }] };

      if (tools.length > 0) {
        body.tools = [{ functionDeclarations: this.formatTools(tools) }];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json();
        return { error: error.error?.message || `HTTP ${response.status}` };
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      return { error: error.message };
    }
  }

  parseResponse(data) {
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return { error: 'No response from Gemini' };
    }

    const content = candidate.content;
    const result = { text: '', toolCalls: [] };

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.text) {
          result.text += part.text;
        }
        if (part.functionCall) {
          const parsed = this.parseArguments(part.functionCall.args);
          result.toolCalls.push({
            ...this.resolveToolCall(part.functionCall.name, part.functionCall.id, parsed.args, { geminiPart: part }),
            parseError: parsed.parseError
          });
        }
      }
    }

    result.functionCalls = result.toolCalls;
    result.assistantMessage = { role: 'assistant', content: result.text, toolCalls: result.toolCalls, providerData: { geminiContent: content } };
    return result;
  }

  async streamMessage(messages, tools = [], onChunk) {
    const result = await this.sendMessage(messages, tools);
    if (result.text) {
      onChunk?.(result.text);
    }
    return result;
  }
}

export default GeminiProvider;
