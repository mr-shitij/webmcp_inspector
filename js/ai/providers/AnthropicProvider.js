/**
 * WebMCP Inspector - Anthropic Claude Provider
 */

import AIProvider from '../AIProvider.js';

class AnthropicProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'Anthropic Claude';
    this.id = 'anthropic';
    this.baseUrl = 'https://api.anthropic.com/v1';
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  getHeaders(contentType = false) {
    const headers = {
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser-origin requests to Anthropic APIs.
      'anthropic-dangerous-direct-browser-access': 'true'
    };

    if (contentType) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  async testConnection() {
    try {
      if (!this.config.apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(false)
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

      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(false)
      });

      if (!response.ok) return [];

      const data = await response.json();
      const models = Array.isArray(data.data) ? data.data : [];

      return models
        .map((model) => ({
          id: model.id,
          name: model.display_name || model.id,
          description: model.type || ''
        }))
        .filter((model) => model.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  formatTools(tools) {
    return this.prepareTools(tools).map(({ providerName, description, schema }) => ({
      name: providerName,
      description,
      input_schema: schema
    }));
  }

  formatMessages(messages) {
    // Extract system message
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    
    const formatted = [];
    for (const msg of chatMessages) {
      if (msg.role === 'assistant') {
        const content = msg.providerData?.anthropicContent || [
          ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
          ...(msg.toolCalls || []).map((call) => ({ type: 'tool_use', id: call.id, name: call.providerName || call.name, input: call.args || {} }))
        ];
        formatted.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: msg.toolCallId, content: this.toolResultText(msg), is_error: Boolean(msg.isError) };
        if (formatted.at(-1)?.role === 'user' && Array.isArray(formatted.at(-1).content)) formatted.at(-1).content.push(block);
        else formatted.push({ role: 'user', content: [block] });
      } else {
        const content = String(msg.content || '');
        if (formatted.at(-1)?.role === 'user' && typeof formatted.at(-1).content === 'string') formatted.at(-1).content += `\n\n${content}`;
        else if (formatted.at(-1)?.role === 'user' && Array.isArray(formatted.at(-1).content)) formatted.at(-1).content.push({ type: 'text', text: content });
        else formatted.push({ role: 'user', content });
      }
    }

    return {
      system: systemMsg?.content,
      messages: formatted
    };
  }

  async sendMessage(messages, tools = []) {
    try {
      const { system, messages: chatMessages } = this.formatMessages(messages);

      const body = {
        model: this.config.model,
        messages: chatMessages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature
      };

      if (system) {
        body.system = system;
      }

      if (tools.length > 0) {
        body.tools = this.formatTools(tools);
      }

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(true),
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
    const result = { text: '', toolCalls: [] };

    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          result.text += block.text;
        } else if (block.type === 'tool_use') {
          result.toolCalls.push(this.resolveToolCall(block.name, block.id, block.input));
        }
      }
    }

    result.functionCalls = result.toolCalls;
    result.assistantMessage = { role: 'assistant', content: result.text, toolCalls: result.toolCalls, providerData: { anthropicContent: data.content } };
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

export default AnthropicProvider;
