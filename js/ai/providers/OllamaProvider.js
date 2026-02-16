/**
 * WebMCP Inspector - Ollama (Local) Provider
 */

import AIProvider from '../AIProvider.js';
import { parseToolInputSchema } from '../utils/toolSchemas.js';

class OllamaProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'Ollama (Local)';
    this.id = 'ollama';
  }

  getBaseUrl() {
    return String(this.config.serverUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  }

  isConfigured() {
    return !!this.config.serverUrl && !!this.config.model;
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
      return `Failed to reach Ollama at ${this.getBaseUrl()}${suffix}. Start the server with 'ollama serve', verify the URL in Settings, and retry.`;
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
    // Ollama tool format (similar to OpenAI)
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: String(tool?.name || ''),
        description: String(tool?.description || ''),
        parameters: parseToolInputSchema(tool?.inputSchema)
      }
    }));
  }

  async sendMessage(messages, tools = []) {
    try {
      if (!this.config.model) {
        return { error: 'No model selected. Please configure Ollama settings.' };
      }

      // Format messages for Ollama
      const formattedMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

      const body = {
        model: this.config.model,
        messages: formattedMessages,
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

    const result = { text: message.content || '', functionCalls: [] };

    // Ollama may return tool calls in different formats depending on version
    if (message.tool_calls) {
      result.functionCalls = message.tool_calls.map(call => ({
        name: call.function?.name || call.name,
        args: call.function?.arguments || call.arguments || {}
      }));
    }

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
