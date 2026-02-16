/**
 * WebMCP Inspector - Main Module Exports
 */

// Settings
export { default as settingsManager, SettingsManager, DEFAULT_SETTINGS } from './settings/SettingsManager.js';

// AI
export { default as aiManager, AIManager } from './ai/AIManager.js';
export { default as AIProvider } from './ai/AIProvider.js';
export { default as GeminiProvider } from './ai/providers/GeminiProvider.js';
export { default as OpenAIProvider } from './ai/providers/OpenAIProvider.js';
export { default as AnthropicProvider } from './ai/providers/AnthropicProvider.js';
export { default as OllamaProvider } from './ai/providers/OllamaProvider.js';

// Initialize function
export async function initialize() {
  await settingsManager.init();
  await aiManager.init();
  console.log('[WebMCP Inspector] Initialized');
}
