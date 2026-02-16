/**
 * WebMCP Inspector - AI Provider Base Class
 * Abstract base class for all AI providers
 */

class AIProvider {
  constructor(config) {
    this.config = config;
    this.name = 'Base Provider';
    this.id = 'base';
  }

  /**
   * Test connection to the provider
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async testConnection() {
    throw new Error('testConnection must be implemented by subclass');
  }

  /**
   * Send a message to the AI
   * @param {Array} messages - Array of message objects
   * @param {Object} tools - Available tools for function calling
   * @returns {Promise<{text?: string, functionCalls?: Array, error?: string}>}
   */
  async sendMessage(messages, tools = []) {
    throw new Error('sendMessage must be implemented by subclass');
  }

  /**
   * Stream a message from the AI
   * @param {Array} messages - Array of message objects
   * @param {Object} tools - Available tools
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<{text?: string, functionCalls?: Array}>}
   */
  async streamMessage(messages, tools = [], onChunk) {
    throw new Error('streamMessage must be implemented by subclass');
  }

  /**
   * Format tools for this provider's API
   * @param {Array} tools - WebMCP tools
   * @returns {Array} Formatted tools
   */
  formatTools(tools) {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: String(tool?.name || ''),
        description: String(tool?.description || ''),
        parameters: (() => {
          if (!tool?.inputSchema) return { type: 'object', properties: {} };
          if (typeof tool.inputSchema === 'string') {
            try {
              const parsed = JSON.parse(tool.inputSchema);
              return parsed && typeof parsed === 'object' ? parsed : { type: 'object', properties: {} };
            } catch {
              return { type: 'object', properties: {} };
            }
          }
          return tool.inputSchema;
        })()
      }
    }));
  }

  /**
   * Parse the response from this provider
   * @param {Object} response - Raw API response
   * @returns {Object} Parsed response
   */
  parseResponse(response) {
    return {
      text: response.text || '',
      functionCalls: response.functionCalls || []
    };
  }

  /**
   * Check if provider is properly configured
   * @returns {boolean}
   */
  isConfigured() {
    return true;
  }

  /**
   * Get available models (for dynamic providers like Ollama)
   * @returns {Promise<Array<{id: string, name: string}>>}
   */
  async getModels() {
    return [];
  }
}

export default AIProvider;
