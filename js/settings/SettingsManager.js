/**
 * WebMCP Inspector - Settings Manager
 * Manages all extension settings including AI providers
 */

const SETTINGS_KEY = 'webmcp_settings_v1';
const MAX_MODELS_PER_PROVIDER = {
  openai: 20,
  default: 40
};
const MAX_MODEL_NAME_LENGTH = 96;
const MAX_MODEL_DESCRIPTION_LENGTH = 140;

// Default settings
const DEFAULT_SETTINGS = {
  version: '1.0.0',
  general: {
    theme: 'system',
    autoOpen: true,
    notifications: true,
    language: 'en'
  },
  ai: {
    defaultProvider: 'gemini',
    providers: {
      gemini: {
        enabled: false,
        name: 'Google Gemini',
        icon: '🔵',
        color: '#4285f4',
        config: {
          apiKey: '',
          model: 'gemini-2.5-flash',
          temperature: 0.7,
          maxTokens: 2048,
          systemPrompt: 'You are an AI assistant helping users interact with web applications using WebMCP tools.'
        },
        models: [
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast, efficient' },
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Complex reasoning' },
          { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Legacy compatibility' }
        ]
      },
      openai: {
        enabled: false,
        name: 'OpenAI GPT',
        icon: '🟢',
        color: '#10a37f',
        config: {
          apiKey: '',
          model: 'gpt-4o',
          temperature: 0.7,
          maxTokens: 2048,
          organization: '',
          systemPrompt: 'You are an AI assistant helping users with WebMCP tools.'
        },
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', description: 'Reliable tool-calling baseline' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Cost-effective' },
          { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Latest flagship' },
          { id: 'gpt-5', name: 'GPT-5', description: 'Most capable' },
          { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Balanced' },
          { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Low latency' }
        ]
      },
      anthropic: {
        enabled: false,
        name: 'Anthropic Claude',
        icon: '🟤',
        color: '#d4a574',
        config: {
          apiKey: '',
          model: 'claude-sonnet-4-20250514',
          temperature: 0.7,
          maxTokens: 4096,
          systemPrompt: 'You are Claude, helping with WebMCP tools.'
        },
        models: [
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Best balance' },
          { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', description: 'Highest capability' },
          { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most powerful' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest' }
        ]
      },
      ollama: {
        enabled: false,
        name: 'Ollama (Local)',
        icon: '🖥️',
        color: '#ff6b6b',
        config: {
          serverUrl: 'http://127.0.0.1:11434',
          model: '',
          temperature: 0.7,
          maxTokens: 2048,
          systemPrompt: 'You are a local AI assistant.'
        },
        models: []
      }
    }
  }
};

class SettingsManager {
  constructor() {
    this.settings = null;
    this.listeners = new Set();
  }

  async init() {
    try {
      const stored = await chrome.storage.sync.get(SETTINGS_KEY);
      this.settings = this.mergeWithDefaults(stored[SETTINGS_KEY] || {});
    } catch (error) {
      console.warn('[SettingsManager] Failed reading sync storage, using defaults:', error);
      this.settings = this.mergeWithDefaults({});
    }
    return this.settings;
  }

  ensureSettings() {
    if (!this.settings) {
      this.settings = this.mergeWithDefaults({});
    }
    return this.settings;
  }

  mergeWithDefaults(stored) {
    return this.deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), stored);
  }

  deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  getAll() {
    this.ensureSettings();
    return this.settings;
  }

  get(path) {
    this.ensureSettings();
    const keys = path.split('.');
    let value = this.settings;
    for (const key of keys) {
      if (value === undefined || value === null) return undefined;
      value = value[key];
    }
    return value;
  }

  async set(path, value) {
    this.ensureSettings();
    const keys = path.split('.');
    let target = this.settings;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!target[keys[i]]) target[keys[i]] = {};
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    await this.save();
    this.notifyListeners(path, value);
    return this.settings;
  }

  async updateProvider(providerId, updates) {
    const current = this.get(`ai.providers.${providerId}`);
    if (!current) throw new Error(`Provider ${providerId} not found`);
    
    const updated = {
      ...current,
      ...updates,
      config: { ...current.config, ...(updates.config || {}) }
    };
    
    await this.set(`ai.providers.${providerId}`, updated);
    return updated;
  }

  async toggleProvider(providerId, enabled) {
    return this.set(`ai.providers.${providerId}.enabled`, enabled);
  }

  async setDefaultProvider(providerId) {
    const provider = this.get(`ai.providers.${providerId}`);
    if (!provider) throw new Error(`Provider ${providerId} not found`);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is not enabled`);
    return this.set('ai.defaultProvider', providerId);
  }

  getActiveProvider() {
    this.ensureSettings();
    const defaultProvider = this.get('ai.defaultProvider');
    const provider = this.get(`ai.providers.${defaultProvider}`);
    if (provider && provider.enabled) {
      return { id: defaultProvider, ...provider };
    }
    
    const providers = this.get('ai.providers');
    for (const [id, config] of Object.entries(providers)) {
      if (config.enabled) return { id, ...config };
    }
    return null;
  }

  getEnabledProviders() {
    this.ensureSettings();
    const providers = this.get('ai.providers');
    return Object.entries(providers)
      .filter(([_, config]) => config.enabled)
      .map(([id, config]) => ({ id, ...config }));
  }

  isQuotaError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return (
      message.includes('quota') ||
      message.includes('kquotabytesperitem') ||
      message.includes('max write operations')
    );
  }

  compactSettingsForSync(settings) {
    const next = JSON.parse(JSON.stringify(settings || {}));
    const providers = next?.ai?.providers;
    if (!providers || typeof providers !== 'object') {
      return next;
    }

    for (const [providerId, provider] of Object.entries(providers)) {
      if (!provider || typeof provider !== 'object') continue;

      const maxModels = providerId === 'openai'
        ? MAX_MODELS_PER_PROVIDER.openai
        : MAX_MODELS_PER_PROVIDER.default;

      const sourceModels = Array.isArray(provider.models) ? provider.models : [];
      const compactedModels = [];
      const seen = new Set();

      for (const model of sourceModels) {
        const id = String(model?.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        compactedModels.push({
          id,
          name: String(model?.name || id).slice(0, MAX_MODEL_NAME_LENGTH),
          description: String(model?.description || '').slice(0, MAX_MODEL_DESCRIPTION_LENGTH)
        });

        if (compactedModels.length >= maxModels) break;
      }

      provider.models = compactedModels;
    }

    return next;
  }

  async save() {
    this.ensureSettings();

    try {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: this.settings });
      return;
    } catch (error) {
      if (!this.isQuotaError(error)) {
        throw error;
      }
    }

    const compacted = this.compactSettingsForSync(this.settings);
    this.settings = compacted;

    try {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: compacted });
    } catch (error) {
      throw new Error(
        `Failed to persist settings after quota compaction: ${String(error?.message || error)}`
      );
    }
  }

  async reset() {
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    await this.save();
    this.notifyListeners('reset', this.settings);
    return this.settings;
  }

  export() {
    return JSON.stringify(this.settings, null, 2);
  }

  async import(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      this.settings = this.mergeWithDefaults(parsed);
      await this.save();
      this.notifyListeners('import', this.settings);
      return true;
    } catch (error) {
      console.error('Failed to import settings:', error);
      return false;
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(path, value) {
    this.listeners.forEach(callback => {
      try {
        callback(path, value, this.settings);
      } catch (error) {
        console.error('Settings listener error:', error);
      }
    });
  }
}

const settingsManager = new SettingsManager();
export default settingsManager;
export { SettingsManager, DEFAULT_SETTINGS };
