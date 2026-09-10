/**
 * WebMCP Inspector - Ollama (Local) Provider
 */

import AIProvider from '../AIProvider.js';

class OllamaProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'Ollama (Local)';
    this.id = 'ollama';
  }

  getBaseUrl() {
    const parsed = new URL(String(this.config.serverUrl || 'http://127.0.0.1:11434'));
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
    if (!loopback || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Ollama Server URL must be an http(s) loopback address (localhost, 127.0.0.1, or ::1).');
    }
    return parsed.href.replace(/\/+$/, '');
  }

  isConfigured() {
    try { this.getBaseUrl(); return !!this.config.model; } catch { return false; }
  }

  async readErrorMessage(response, fallback) {
    let detail = '';
    try {
      const text = await response.text();
      if (text) {
        detail = text;
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          // keep plain text
        }
      }
    } catch {
      // ignore body parsing errors
    }

    let message = detail || fallback || `HTTP ${response.status}`;
    if (response.status === 403) {
      const extensionOrigin =
        typeof chrome !== 'undefined' && chrome?.runtime?.id
          ? `chrome-extension://${chrome.runtime.id}`
          : 'chrome-extension://<your-extension-id>';
      message = `${message}. Ollama denied this request (403). If Ollama is local, allow extension origin via OLLAMA_ORIGINS (e.g. "${extensionOrigin}" or "*") and restart Ollama. Also verify you are targeting the Ollama server directly (not an auth proxy).`;
    }

    return message;
  }

  formatFetchFailure(error, endpoint = '') {
    const raw = String(error?.message || error || 'Unknown network error');
    if (/failed to fetch|networkerror|load failed/i.test(raw)) {
      const suffix = endpoint ? ` (${endpoint})` : '';
      let baseUrl = 'the configured loopback URL';
      try { baseUrl = this.getBaseUrl(); } catch {}
      return `Failed to reach Ollama at ${baseUrl}${suffix}. Start the server with 'ollama serve', verify the URL in Settings, and retry.`;
    }
    return raw;
  }

  async testConnection() {
    try {
      if (!this.config.serverUrl) {
        return { success: false, error: 'Server URL not configured' };
      }

      const response = await fetch(`${this.getBaseUrl()}/api/tags`);

      if (!response.ok) {
        const error = await this.readErrorMessage(
          response,
          `Cannot connect to Ollama at ${this.config.serverUrl}`
        );
        return { success: false, error };
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Connection failed: ${this.formatFetchFailure(error, '/api/tags')}` 
      };
    }
  }

  async getModels() {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/tags`);
      if (!response.ok) {
        console.warn('[OllamaProvider] Failed to load models:', await this.readErrorMessage(response, 'Model list request failed'));
        return [];
      }
      
      const data = await response.json();
      return data.models?.map(m => ({
        id: m.name,
        name: m.name,
        description: m.details?.parameter_size || `${(m.size / 1e9).toFixed(1)} GB`
      })) || [];
    } catch (error) {
      console.warn('[OllamaProvider] Failed to load models:', this.formatFetchFailure(error, '/api/tags'));
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
        const formatted = { role: 'assistant', content: message.content || '' };
        if (message.toolCalls?.length) formatted.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.providerName || call.name, arguments: call.args || {} }
        }));
        return formatted;
      }
      if (message.role === 'tool') return {
        role: 'tool',
        content: this.toolResultText(message),
        tool_name: message.providerName || message.name
      };
      return { role: message.role === 'system' ? 'system' : 'user', content: String(message.content || '') };
    });
  }

  async sendMessage(messages, tools = []) {
    try {
      if (!this.config.model) {
        return { error: 'No model selected. Please configure Ollama settings.' };
      }

      const body = {
        model: this.config.model,
        messages: this.formatMessages(messages),
        stream: false,
        options: {
          temperature: this.config.temperature,
          num_predict: this.config.maxTokens
        }
      };

      if (tools.length > 0) {
        body.tools = this.formatTools(tools);
      }

      const response = await fetch(`${this.getBaseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await this.readErrorMessage(response, `HTTP ${response.status}`);
        return { error };
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      return { error: this.formatFetchFailure(error, '/api/chat') };
    }
  }

  parseResponse(data) {
    const message = data.message;
    if (!message) {
      return { error: 'No response from Ollama' };
    }

    const result = { text: message.content || '', toolCalls: [] };

    // Ollama may return tool calls in different formats depending on version
    if (message.tool_calls) {
      result.toolCalls = message.tool_calls.map((call) => {
        const parsed = this.parseArguments(call.function?.arguments || call.arguments || {});
        return { ...this.resolveToolCall(call.function?.name || call.name, call.id, parsed.args), parseError: parsed.parseError };
      });
    }
    result.functionCalls = result.toolCalls;
    result.assistantMessage = { role: 'assistant', content: result.text, toolCalls: result.toolCalls };
    return result;
  }

  async streamMessage(messages, tools = [], onChunk) {
    // Ollama supports streaming but simplified here
    const result = await this.sendMessage(messages, tools);
    if (result.text) {
      onChunk?.(result.text);
    }
    return result;
  }
}

export default OllamaProvider;
