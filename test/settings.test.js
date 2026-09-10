import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../js/settings/SettingsManager.js';

function installStorage(syncState = {}, localState = {}) {
  const writes = { sync: [], local: [], removed: [] };
  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => syncState,
        set: async (value) => writes.sync.push(value),
        remove: async (key) => writes.removed.push(key)
      },
      local: {
        get: async () => localState,
        set: async (value) => writes.local.push(value)
      }
    }
  };
  return writes;
}

test('legacy synced API keys migrate to local-only storage and exports omit secrets', async () => {
  const writes = installStorage({
    webmcp_settings_v1: {
      ai: { providers: { openai: { enabled: true, config: { apiKey: 'secret-key', model: 'gpt-4o' } } } }
    }
  });
  const manager = new SettingsManager();
  await manager.init();
  assert.equal(manager.get('ai.providers.openai.config.apiKey'), 'secret-key');
  assert.equal(writes.local[0].webmcp_provider_secrets_v1.openai, 'secret-key');
  assert.equal(writes.sync[0].webmcp_settings_v2.ai.providers.openai.config.apiKey, undefined);
  assert.equal(writes.removed[0], 'webmcp_settings_v1');
  assert.doesNotMatch(manager.export(), /secret-key/);
});

test('deep merge ignores prototype-pollution keys', () => {
  installStorage();
  const manager = new SettingsManager();
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"general":{"theme":"dark"}}');
  const merged = manager.mergeWithDefaults(malicious);
  assert.equal(merged.general.theme, 'dark');
  assert.equal({}.polluted, undefined);
});
