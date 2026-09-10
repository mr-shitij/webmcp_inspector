/**
 * WebMCP Inspector - OpenAI Provider
 */

import AIProvider from '../AIProvider.js';

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
    return this.prepareTools(tools).map(({ providerName, description, schema }) => ({
      type: 'function',
      function: {
        name: providerName,
        description,
        parameters: schema
      }
    }));
  }

  formatMessages(messages) {
    return messages.map((message) => {
      if (message.role === 'assistant') {
        const formatted = { role: 'assistant', content: message.content || null };
        if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
          formatted.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.providerName || call.name, arguments: JSON.stringify(call.args ?? {}) }
          }));
        }
        return formatted;
      }
      if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: this.toolResultText(message) };
      }
      return { role: message.role === 'system' ? 'system' : 'user', content: String(message.content || '') };
    });
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
      messages: this.formatMessages(messages)
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

      if (param === 'temperature' && Object.prototype.hasOwnProperty.call(next, param)) {
        delete next[param];
        changed = true;
      }
    }

    if (/temperature/i.test(message) && /not supported|unsupported/i.test(message) && next.temperature !== undefined) {
      delete next.temperature;
      changed = true;
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

    const result = { text: message.content || '', toolCalls: [] };

    if (message.tool_calls) {
      result.toolCalls = message.tool_calls.map((call) => {
        const parsed = this.parseArguments(call.function?.arguments);
        return { ...this.resolveToolCall(call.function?.name, call.id, parsed.args), parseError: parsed.parseError };
      });
    }
    result.functionCalls = result.toolCalls;
    result.assistantMessage = { role: 'assistant', content: result.text, toolCalls: result.toolCalls };

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
