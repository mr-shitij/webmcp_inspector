/**
 * WebMCP Inspector - OpenAI Provider
 */

import AIProvider from '../AIProvider.js';
import { parseToolInputSchema } from '../utils/toolSchemas.js';

class OpenAIProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'OpenAI GPT';
    this.id = 'openai';
    this.baseUrl = 'https://api.openai.com/v1';
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  async testConnection() {
    try {
      if (!this.config.apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      });

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

      const headers = {
        'Authorization': `Bearer ${this.config.apiKey}`
      };
      if (this.config.organization) {
        headers['OpenAI-Organization'] = this.config.organization;
      }

      const response = await fetch(`${this.baseUrl}/models`, { headers });
      if (!response.ok) return [];

      const data = await response.json();
      const raw = Array.isArray(data.data) ? data.data : [];

      return raw
        .map((model) => ({
          id: model.id,
          name: model.id,
          description: ''
        }))
        .filter((model) => typeof model.id === 'string' && model.id.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  formatTools(tools) {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: String(tool?.name || ''),
        description: String(tool?.description || ''),
        parameters: parseToolInputSchema(tool?.inputSchema)
      }
    }));
  }

  getTokenParamForModel(modelId) {
    const model = String(modelId || '').toLowerCase();
    if (
      model.startsWith('gpt-5') ||
      model.startsWith('o1') ||
      model.startsWith('o3') ||
      model.startsWith('o4')
    ) {
      return 'max_completion_tokens';
    }
    return 'max_tokens';
  }

  buildRequestBody(messages, tools = []) {
    const body = {
      model: this.config.model,
      messages: messages
    };

    const temperature = Number(this.config.temperature);
    if (Number.isFinite(temperature)) {
      body.temperature = temperature;
    }

    const tokenLimit = Number(this.config.maxTokens);
    if (Number.isFinite(tokenLimit) && tokenLimit > 0) {
      const tokenParam = this.getTokenParamForModel(this.config.model);
      body[tokenParam] = Math.round(tokenLimit);
    }

    if (tools.length > 0) {
      body.tools = this.formatTools(tools);
      body.tool_choice = 'auto';
    }

    return body;
  }

  async readApiError(response) {
    try {
      const payload = await response.json();
      return payload?.error?.message || JSON.stringify(payload);
    } catch {
      try {
        const text = await response.text();
        return text || `HTTP ${response.status}`;
      } catch {
        return `HTTP ${response.status}`;
      }
    }
  }

  adjustUnsupportedPayload(payload, errorMessage) {
    const message = String(errorMessage || '');
    const next = JSON.parse(JSON.stringify(payload));
    let changed = false;

    const unsupportedMatches = [...message.matchAll(/Unsupported parameter:\s*'([^']+)'/gi)];
    for (const match of unsupportedMatches) {
      const param = String(match[1] || '').trim();
      if (!param) continue;

      if (param === 'max_tokens' && next.max_tokens !== undefined) {
        const current = next.max_tokens;
        delete next.max_tokens;
        if (/max_completion_tokens/i.test(message) && next.max_completion_tokens === undefined) {
          next.max_completion_tokens = current;
        }
        changed = true;
        continue;
      }

      if (param === 'max_completion_tokens' && next.max_completion_tokens !== undefined) {
        const current = next.max_completion_tokens;
        delete next.max_completion_tokens;
        if (/max_tokens/i.test(message) && next.max_tokens === undefined) {
          next.max_tokens = current;
        }
        changed = true;
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(next, param)) {
        delete next[param];
        changed = true;
      }
    }

    if (/temperature/i.test(message) && /not supported|unsupported/i.test(message) && next.temperature !== undefined) {
      delete next.temperature;
      changed = true;
    }

    if (/tool_choice/i.test(message) && /not supported|unsupported/i.test(message) && next.tool_choice !== undefined) {
      delete next.tool_choice;
      changed = true;
    }

    if (/tools?/i.test(message) && /not supported|unsupported/i.test(message)) {
      if (next.tools !== undefined || next.tool_choice !== undefined) {
        delete next.tools;
        delete next.tool_choice;
        changed = true;
      }
    }

    if (changed) {
      return next;
    }
    return null;
  }

  async sendMessage(messages, tools = []) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      };

      if (this.config.organization) {
        headers['OpenAI-Organization'] = this.config.organization;
      }

      let body = this.buildRequestBody(messages, tools);
      let lastError = '';

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (response.ok) {
          const data = await response.json();
          return this.parseResponse(data);
        }

        lastError = await this.readApiError(response);
        const adjusted = this.adjustUnsupportedPayload(body, lastError);
        if (!adjusted) {
          return { error: lastError || `HTTP ${response.status}` };
        }
        body = adjusted;
      }

      return { error: lastError || 'OpenAI request failed' };
    } catch (error) {
      return { error: error.message };
    }
  }

  parseResponse(data) {
    const message = data.choices?.[0]?.message;
    if (!message) {
      return { error: 'No response from OpenAI' };
    }

    const result = { text: message.content || '', functionCalls: [] };

    if (message.tool_calls) {
      result.functionCalls = message.tool_calls.map(call => ({
        name: call.function.name,
        args: (() => {
          try {
            return JSON.parse(call.function.arguments || '{}');
          } catch {
            return {};
          }
        })()
      }));
    }

    return result;
  }

  async streamMessage(messages, tools = [], onChunk) {
    // Simplified streaming - just call regular method
    const result = await this.sendMessage(messages, tools);
    if (result.text) {
      onChunk?.(result.text);
    }
    return result;
  }
}

export default OpenAIProvider;
