/**
 * WebMCP Inspector - Google Gemini Provider
 */

import AIProvider from '../AIProvider.js';
import { parseToolInputSchema, toGeminiSchema } from '../utils/toolSchemas.js';

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

      const response = await fetch(
        `${this.baseUrl}/models?key=${this.config.apiKey}`
      );

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
      const response = await fetch(`${this.baseUrl}/models?key=${this.config.apiKey}`);
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
    return tools.map((tool) => ({
      name: String(tool?.name || ''),
      description: String(tool?.description || ''),
      parameters: toGeminiSchema(parseToolInputSchema(tool?.inputSchema))
    }));
  }

  formatMessages(messages) {
    return messages.map(msg => {
      if (msg.role === 'system') {
        return { role: 'user', parts: [{ text: `System: ${msg.content}` }] };
      }
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      };
    });
  }

  async sendMessage(messages, tools = []) {
    try {
      const url = `${this.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;
      
      const body = {
        contents: this.formatMessages(messages),
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens
        }
      };

      if (tools.length > 0) {
        body.tools = [{ functionDeclarations: this.formatTools(tools) }];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const result = { text: '', functionCalls: [] };

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.text) {
          result.text += part.text;
        }
        if (part.functionCall) {
          let args = part.functionCall.args;
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {
              args = {};
            }
          }
          result.functionCalls.push({
            name: part.functionCall.name,
            args: args && typeof args === 'object' ? args : {}
          });
        }
      }
    }

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
