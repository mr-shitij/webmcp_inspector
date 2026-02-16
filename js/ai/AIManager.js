/**
 * WebMCP Inspector - AI Manager
 * Coordinates between different AI providers
 */

import settingsManager from '../settings/SettingsManager.js';
import GeminiProvider from './providers/GeminiProvider.js';
import OpenAIProvider from './providers/OpenAIProvider.js';
import AnthropicProvider from './providers/AnthropicProvider.js';
import OllamaProvider from './providers/OllamaProvider.js';

class AIManager {
  constructor() {
    this.providers = new Map();
    this.currentProvider = null;
  }

  /**
   * Initialize the AI manager
   */
  async init() {
    await this.loadProvider();
  }

  /**
   * Get provider class by ID
   */
  getProviderClass(providerId) {
    const classes = {
      gemini: GeminiProvider,
      openai: OpenAIProvider,
      anthropic: AnthropicProvider,
      ollama: OllamaProvider
    };
    return classes[providerId] || null;
  }

  /**
   * Load the current provider from settings
   */
  async loadProvider() {
    const activeProvider = settingsManager.getActiveProvider();
    
    if (!activeProvider) {
      this.currentProvider = null;
      return null;
    }

    const ProviderClass = this.getProviderClass(activeProvider.id);
    if (!ProviderClass) {
      console.error(`Unknown provider: ${activeProvider.id}`);
      return null;
    }

    this.currentProvider = new ProviderClass(activeProvider.config);
    return this.currentProvider;
  }

  /**
   * Get current provider instance
   */
  getCurrentProvider() {
    return this.currentProvider;
  }

  /**
   * Get provider info by ID
   */
  getProvider(providerId) {
    return settingsManager.get(`ai.providers.${providerId}`);
  }

  /**
   * Get all providers info
   */
  getAllProviders() {
    const providers = settingsManager.get('ai.providers');
    return Object.entries(providers).map(([id, config]) => ({
      id,
      ...config
    }));
  }

  /**
   * Get enabled providers
   */
  getEnabledProviders() {
    return settingsManager.getEnabledProviders();
  }

  /**
   * Switch to a different provider
   */
  async switchProvider(providerId) {
    await settingsManager.setDefaultProvider(providerId);
    return this.loadProvider();
  }

  /**
   * Test a provider connection
   */
  async testProvider(providerId) {
    const providerConfig = this.getProvider(providerId);
    if (!providerConfig) {
      return { success: false, error: 'Provider not found' };
    }

    const ProviderClass = this.getProviderClass(providerId);
    if (!ProviderClass) {
      return { success: false, error: 'Provider class not found' };
    }

    const provider = new ProviderClass(providerConfig.config);
    return provider.testConnection();
  }

  /**
   * Update provider configuration
   */
  async updateProvider(providerId, updates) {
    return settingsManager.updateProvider(providerId, updates);
  }

  /**
   * Enable/disable a provider
   */
  async toggleProvider(providerId, enabled) {
    return settingsManager.toggleProvider(providerId, enabled);
  }

  /**
   * Get available models for a provider (for Ollama)
   */
  async getModels(providerId) {
    const providerConfig = this.getProvider(providerId);
    if (!providerConfig) return [];

    const ProviderClass = this.getProviderClass(providerId);
    const provider = new ProviderClass(providerConfig.config);
    
    if (provider.getModels) {
      return provider.getModels();
    }
    
    return providerConfig.models || [];
  }

  /**
   * Send a message using current provider
   */
  async sendMessage(messages, tools = []) {
    if (!this.currentProvider) {
      return { error: 'No AI provider configured. Please configure in Settings.' };
    }

    if (!this.currentProvider.isConfigured()) {
      return { error: 'Provider not properly configured. Please check Settings.' };
    }

    // Add system prompt if not present
    if (!messages.some(m => m.role === 'system')) {
      const systemPrompt = settingsManager.get(`ai.providers.${settingsManager.get('ai.defaultProvider')}.config.systemPrompt`);
      if (systemPrompt) {
        messages = [{ role: 'system', content: systemPrompt }, ...messages];
      }
    }

    return this.currentProvider.sendMessage(messages, tools);
  }

  /**
   * Stream a message using current provider
   */
  async streamMessage(messages, tools = [], onChunk) {
    if (!this.currentProvider) {
      return { error: 'No AI provider configured' };
    }

    // Add system prompt if not present
    if (!messages.some(m => m.role === 'system')) {
      const systemPrompt = settingsManager.get(`ai.providers.${settingsManager.get('ai.defaultProvider')}.config.systemPrompt`);
      if (systemPrompt) {
        messages = [{ role: 'system', content: systemPrompt }, ...messages];
      }
    }

    return this.currentProvider.streamMessage(messages, tools, onChunk);
  }

  /**
   * Check if AI is ready to use
   */
  isReady() {
    return this.currentProvider && this.currentProvider.isConfigured();
  }

  /**
   * Get current provider name
   */
  getCurrentProviderName() {
    return this.currentProvider?.name || 'None';
  }

  /**
   * Get current provider ID
   */
  getCurrentProviderId() {
    return settingsManager.get('ai.defaultProvider');
  }

  /**
   * Format tools for the current provider
   */
  formatTools(tools) {
    if (!this.currentProvider) return [];
    return this.currentProvider.formatTools(tools);
  }
}

// Export singleton
const aiManager = new AIManager();
export default aiManager;
export { AIManager };
