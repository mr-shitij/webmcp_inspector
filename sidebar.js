/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebMCP Inspector - Side Panel App
 */

import { aiManager, settingsManager } from './js/index.js';

const PROVIDER_COLORS = {
  gemini: '#4285f4',
  openai: '#10a37f',
  anthropic: '#d4a574',
  ollama: '#ff6b6b'
};

class SidePanelApp {
  constructor() {
    this.tools = [];
    this.selectedTool = null;
    this.currentUrl = '';
    this.aiMessages = [];
    this.trace = [];
    this.currentProviderId = null;

    this.dom = {
      globalStatus: document.getElementById('globalStatus'),
      contextDot: document.getElementById('contextDot'),
      contextText: document.getElementById('contextText'),
      tabToolCount: document.getElementById('tabToolCount'),

      tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
      tabPanels: Array.from(document.querySelectorAll('.tab-panel')),

      headerRefreshBtn: document.getElementById('headerRefreshBtn'),
      toolsRefreshBtn: document.getElementById('toolsRefreshBtn'),
      toolSearchInput: document.getElementById('toolSearchInput'),
      imperativeCount: document.getElementById('imperativeCount'),
      declarativeCount: document.getElementById('declarativeCount'),
      imperativeToolList: document.getElementById('imperativeToolList'),
      declarativeToolList: document.getElementById('declarativeToolList'),

      selectedToolName: document.getElementById('selectedToolName'),
      selectedToolDescription: document.getElementById('selectedToolDescription'),
      selectedToolType: document.getElementById('selectedToolType'),
      selectedToolReadOnly: document.getElementById('selectedToolReadOnly'),
      selectedToolSource: document.getElementById('selectedToolSource'),
      selectedToolSchema: document.getElementById('selectedToolSchema'),
      toolInputArgs: document.getElementById('toolInputArgs'),
      toolInputResetBtn: document.getElementById('toolInputResetBtn'),
      toolCopyJsonBtn: document.getElementById('toolCopyJsonBtn'),
      toolExecuteBtn: document.getElementById('toolExecuteBtn'),
      toolExecutionResult: document.getElementById('toolExecutionResult'),
      copySelectedToolBtn: document.getElementById('copySelectedToolBtn'),

      aiProviderLabel: document.getElementById('aiProviderLabel'),
      goToSettingsBtn: document.getElementById('goToSettingsBtn'),
      chatTranscript: document.getElementById('chatTranscript'),
      aiPromptInput: document.getElementById('aiPromptInput'),
      aiSendBtn: document.getElementById('aiSendBtn'),
      aiResetBtn: document.getElementById('aiResetBtn'),
      aiCopyTraceBtn: document.getElementById('aiCopyTraceBtn'),

      settingTheme: document.getElementById('settingTheme'),
      settingAutoOpen: document.getElementById('settingAutoOpen'),
      settingNotifications: document.getElementById('settingNotifications'),
      saveGeneralSettingsBtn: document.getElementById('saveGeneralSettingsBtn'),

      providerCards: document.getElementById('providerCards'),
      providerEditorTitle: document.getElementById('providerEditorTitle'),
      providerStatus: document.getElementById('providerStatus'),
      providerApiKey: document.getElementById('providerApiKey'),
      providerServerUrl: document.getElementById('providerServerUrl'),
      providerOrganization: document.getElementById('providerOrganization'),
      providerModelSelect: document.getElementById('providerModelSelect'),
      providerTemperature: document.getElementById('providerTemperature'),
      providerMaxTokens: document.getElementById('providerMaxTokens'),
      providerSystemPrompt: document.getElementById('providerSystemPrompt'),
      providerRefreshModelsBtn: document.getElementById('providerRefreshModelsBtn'),
      providerTestBtn: document.getElementById('providerTestBtn'),
      providerSaveBtn: document.getElementById('providerSaveBtn'),
      providerSaveDefaultBtn: document.getElementById('providerSaveDefaultBtn'),
      providerDisableBtn: document.getElementById('providerDisableBtn'),

      helpRepoLink: document.getElementById('helpRepoLink'),
      helpExtensionId: document.getElementById('helpExtensionId'),
      helpOllamaExportBlock: document.getElementById('helpOllamaExportBlock'),
      helpOllamaCurlBlock: document.getElementById('helpOllamaCurlBlock')
    };
  }

  async init() {
    this.bindEvents();
    this.setActiveTab('tools');

    await settingsManager.init();
    await aiManager.init();

    this.loadGeneralSettingsIntoUI();
    this.renderProviderCards();

    const defaultProvider = settingsManager.get('ai.defaultProvider');
    if (defaultProvider) {
      this.openProviderEditor(defaultProvider);
    }

    this.populateHelpMetadata();
    this.updateAIProviderLabel();
    await this.refreshTools(true);

    // If popup requested a specific tool, select it.
    const { selectedTool } = await chrome.storage.local.get(['selectedTool']);
    if (selectedTool) {
      this.selectToolByName(selectedTool);
      await chrome.storage.local.remove('selectedTool');
    }
  }

  populateHelpMetadata() {
    const manifest = chrome.runtime?.getManifest?.() || {};
    const homepageUrl =
      typeof manifest.homepage_url === 'string' ? manifest.homepage_url.trim() : '';
    const extensionId = chrome.runtime?.id || '<your-extension-id>';

    if (this.dom.helpRepoLink) {
      if (homepageUrl) {
        this.dom.helpRepoLink.href = homepageUrl;
        this.dom.helpRepoLink.textContent = homepageUrl;
      } else {
        this.dom.helpRepoLink.removeAttribute('href');
        this.dom.helpRepoLink.textContent = 'Not configured in manifest homepage_url';
      }
    }

    if (this.dom.helpExtensionId) {
      this.dom.helpExtensionId.textContent = extensionId;
    }

    if (this.dom.helpOllamaExportBlock) {
      this.dom.helpOllamaExportBlock.textContent =
        `export OLLAMA_ORIGINS="chrome-extension://${extensionId}"\n` +
        'export OLLAMA_HOST="127.0.0.1:11434"\n' +
        'ollama serve';
    }

    if (this.dom.helpOllamaCurlBlock) {
      this.dom.helpOllamaCurlBlock.textContent =
        `curl -i -H "Origin: chrome-extension://${extensionId}" ` +
        'http://127.0.0.1:11434/api/tags';
    }
  }

  bindEvents() {
    this.dom.tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.setActiveTab(button.dataset.tab || 'tools');
      });
    });

    this.dom.headerRefreshBtn.addEventListener('click', () => this.refreshTools(true));
    this.dom.toolsRefreshBtn.addEventListener('click', () => this.refreshTools(true));
    this.dom.toolSearchInput.addEventListener('input', () => this.renderToolLists());

    this.dom.toolInputResetBtn.addEventListener('click', () => this.resetToolInputToTemplate());
    this.dom.toolCopyJsonBtn.addEventListener('click', () => this.copyCurrentToolInput());
    this.dom.toolExecuteBtn.addEventListener('click', () => this.executeSelectedTool());
    this.dom.copySelectedToolBtn.addEventListener('click', () => this.copySelectedToolConfig());

    this.dom.goToSettingsBtn.addEventListener('click', () => this.setActiveTab('settings'));
    this.dom.aiSendBtn.addEventListener('click', () => this.sendAIMessage());
    this.dom.aiResetBtn.addEventListener('click', () => this.resetAIConversation());
    this.dom.aiCopyTraceBtn.addEventListener('click', () => this.copyTrace());
    this.dom.aiPromptInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.sendAIMessage();
      }
    });

    this.dom.saveGeneralSettingsBtn.addEventListener('click', () => this.saveGeneralSettings());
    this.dom.providerRefreshModelsBtn.addEventListener('click', () => this.refreshProviderModels());
    this.dom.providerTestBtn.addEventListener('click', () => this.testProviderConnection());
    this.dom.providerSaveBtn.addEventListener('click', () => this.saveProvider(false));
    this.dom.providerSaveDefaultBtn.addEventListener('click', () => this.saveProvider(true));
    this.dom.providerDisableBtn.addEventListener('click', () => this.disableProvider());

    chrome.runtime.onMessage.addListener((message) => {
      switch (message.type) {
        case 'TOOLS_UPDATE':
          this.handleToolsUpdate(message.tools || [], message.url || '');
          break;
        case 'STATUS_UPDATE':
          this.showStatus(message.message || '', message.messageType || 'info', 4000);
          break;
        case 'TOOL_EVENT':
          this.trace.push({
            ts: new Date().toISOString(),
            type: 'tool_event',
            event: message.event,
            toolName: message.toolName
          });
          break;
        default:
          break;
      }
    });
  }

  setActiveTab(tabName) {
    this.dom.tabButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === tabName);
    });

    this.dom.tabPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  showStatus(message, type = 'info', timeoutMs = 0) {
    if (!message) {
      this.dom.globalStatus.hidden = true;
      this.dom.globalStatus.textContent = '';
      this.dom.globalStatus.className = 'status-bar';
      return;
    }

    this.dom.globalStatus.hidden = false;
    this.dom.globalStatus.textContent = message;
    this.dom.globalStatus.className = `status-bar ${type}`;

    if (timeoutMs > 0) {
      clearTimeout(this.statusTimeout);
      this.statusTimeout = setTimeout(() => this.showStatus(''), timeoutMs);
    }
  }

  setContext(url, hasTools) {
    this.currentUrl = url || this.currentUrl;
    const label = this.currentUrl ? this.safeHostFromUrl(this.currentUrl) : 'No active page';
    this.dom.contextText.textContent = label;
    this.dom.contextDot.classList.toggle('active', !!hasTools);
  }

  safeHostFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.host || url;
    } catch {
      return url;
    }
  }

  async refreshTools(forceRefresh = false) {
    try {
      this.showStatus(forceRefresh ? 'Refreshing tools...' : 'Loading tools...', 'info');
      const response = await chrome.runtime.sendMessage({
        type: forceRefresh ? 'REFRESH_TOOLS' : 'GET_TOOLS',
        forceRefresh
      });

      if (response?.error) {
        this.handleToolsUpdate([], response.url || '');
        this.setContext(response.url || '', false);
        this.showStatus(response.error, 'warning', 5000);
        return;
      }

      const tools = Array.isArray(response?.tools) ? response.tools : [];
      const url = response?.url || '';
      this.handleToolsUpdate(tools, url);
      this.showStatus(`Loaded ${tools.length} tool${tools.length === 1 ? '' : 's'}`, 'success', 2500);
    } catch (error) {
      this.showStatus(`Failed to load tools: ${error.message}`, 'error', 6000);
    }
  }

  handleToolsUpdate(tools, url) {
    this.tools = tools;
    this.dom.tabToolCount.textContent = String(tools.length);
    this.setContext(url, tools.length > 0);

    this.renderToolLists();

    if (!this.selectedTool && tools.length > 0) {
      this.selectTool(tools[0]);
    } else if (this.selectedTool) {
      const updated = tools.find((tool) => tool.name === this.selectedTool.name);
      if (updated) {
        this.selectTool(updated);
      } else {
        this.selectTool(null);
      }
    } else {
      this.selectTool(null);
    }

    this.updateAIProviderLabel();
  }

  renderToolLists() {
    this.dom.imperativeToolList.innerHTML = '';
    this.dom.declarativeToolList.innerHTML = '';

    const query = this.dom.toolSearchInput.value.trim().toLowerCase();
    const filtered = this.tools.filter((tool) => {
      if (!query) return true;
      const haystack = `${tool.name || ''} ${tool.description || ''}`.toLowerCase();
      return haystack.includes(query);
    });

    const imperative = filtered.filter((tool) => !this.isDeclarativeTool(tool));
    const declarative = filtered.filter((tool) => this.isDeclarativeTool(tool));

    this.dom.imperativeCount.textContent = String(imperative.length);
    this.dom.declarativeCount.textContent = String(declarative.length);

    this.renderToolGroup(this.dom.imperativeToolList, imperative);
    this.renderToolGroup(this.dom.declarativeToolList, declarative);

    if (imperative.length === 0) {
      this.appendEmptyGroupMessage(this.dom.imperativeToolList, 'No imperative tools found');
    }

    if (declarative.length === 0) {
      this.appendEmptyGroupMessage(this.dom.declarativeToolList, 'No declarative tools found');
    }
  }

  renderToolGroup(container, tools) {
    for (const tool of tools) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool-item';
      button.classList.toggle('active', this.selectedTool?.name === tool.name);

      const name = document.createElement('div');
      name.className = 'tool-item-name';
      name.textContent = tool.name || '(unnamed_tool)';

      const desc = document.createElement('div');
      desc.className = 'tool-item-desc';
      desc.textContent = tool.description || 'No description';

      const meta = document.createElement('div');
      meta.className = 'tool-item-meta';
      meta.textContent = this.isDeclarativeTool(tool) ? 'HTML Form / Declarative' : 'JavaScript / Imperative';

      button.appendChild(name);
      button.appendChild(desc);
      button.appendChild(meta);

      button.addEventListener('click', () => {
        this.selectTool(tool);
        this.renderToolLists();
      });

      container.appendChild(button);
    }
  }

  appendEmptyGroupMessage(container, message) {
    const div = document.createElement('div');
    div.className = 'tool-item';
    div.style.cursor = 'default';
    div.textContent = message;
    container.appendChild(div);
  }

  isDeclarativeTool(tool) {
    if (tool?.type === 'declarative') return true;
    if (tool?.kind === 'form') return true;
    if (tool?.source === 'form') return true;
    if (typeof tool?.source === 'string' && tool.source.toLowerCase().includes('form')) return true;
    return false;
  }

  selectToolByName(name) {
    const found = this.tools.find((tool) => tool.name === name);
    if (found) {
      this.selectTool(found);
      this.renderToolLists();
      this.setActiveTab('tools');
    }
  }

  selectTool(tool) {
    this.selectedTool = tool;

    if (!tool) {
      this.dom.selectedToolName.textContent = 'Select a tool';
      this.dom.selectedToolDescription.textContent = 'Choose a tool from the list to inspect and execute it.';
      this.dom.selectedToolType.textContent = '-';
      this.dom.selectedToolReadOnly.textContent = '-';
      this.dom.selectedToolSource.textContent = '-';
      this.dom.selectedToolSchema.textContent = '';
      this.dom.toolInputArgs.value = '{}';
      this.toggleToolActions(false);
      this.dom.toolExecutionResult.textContent = '';
      return;
    }

    this.dom.selectedToolName.textContent = tool.name || '(unnamed_tool)';
    this.dom.selectedToolDescription.textContent = tool.description || 'No description';
    this.dom.selectedToolType.textContent = this.isDeclarativeTool(tool)
      ? 'Declarative (HTML Form)'
      : 'Imperative (JavaScript)';

    const readOnlyHint = tool?.annotations?.readOnlyHint;
    this.dom.selectedToolReadOnly.textContent =
      readOnlyHint === true ? 'Yes' : readOnlyHint === false ? 'No' : 'Unknown';

    this.dom.selectedToolSource.textContent = tool.source || (this.isDeclarativeTool(tool) ? 'HTML Form' : 'JavaScript');

    const schema = this.parseSchema(tool.inputSchema);
    this.dom.selectedToolSchema.textContent = JSON.stringify(schema, null, 2);

    this.dom.toolInputArgs.value = JSON.stringify(this.generateTemplateFromSchema(schema, []), null, 2);
    this.dom.toolExecutionResult.textContent = '';

    this.toggleToolActions(true);
  }

  toggleToolActions(enabled) {
    this.dom.toolInputArgs.disabled = !enabled;
    this.dom.toolInputResetBtn.disabled = !enabled;
    this.dom.toolCopyJsonBtn.disabled = !enabled;
    this.dom.toolExecuteBtn.disabled = !enabled;
    this.dom.copySelectedToolBtn.disabled = !enabled;
  }

  parseSchema(schema) {
    if (!schema) return { type: 'object', properties: {} };
    if (typeof schema === 'string') {
      try {
        return JSON.parse(schema);
      } catch {
        return { type: 'object', properties: {} };
      }
    }
    return schema;
  }

  generateTemplateFromSchema(schema, path = []) {
    if (!schema || typeof schema !== 'object') return {};

    if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
    if (Object.prototype.hasOwnProperty.call(schema, 'default')) return schema.default;
    if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
      return this.generateTemplateFromSchema(schema.oneOf[0], path);
    }

    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
      return this.generateTemplateFromSchema(schema.anyOf[0], path);
    }

    switch (schema.type) {
      case 'object': {
        const out = {};
        const properties = schema.properties || {};
        for (const [key, childSchema] of Object.entries(properties)) {
          out[key] = this.generateTemplateFromSchema(childSchema, [...path, key]);
        }
        return out;
      }
      case 'array': {
        if (schema.items) {
          return [this.generateTemplateFromSchema(schema.items, [...path, '0'])];
        }
        return [];
      }
      case 'string': {
        const fieldName = String(path[path.length - 1] || '').toLowerCase();

        if (schema.format === 'date') {
          if (fieldName.includes('inbound') || fieldName.includes('return')) {
            return this.getFutureDateISO(2);
          }
          return this.getFutureDateISO(1);
        }
        if (schema.format === 'date-time') return new Date().toISOString();
        if (schema.format === 'email') return 'user@example.com';
        if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';

        if (Array.isArray(schema.enum) && schema.enum.length > 0) {
          return String(schema.enum[0]);
        }

        const pattern = typeof schema.pattern === 'string' ? schema.pattern : '';
        if (pattern === '^[A-Z]{3}$') {
          if (fieldName.includes('dest') || fieldName.includes('arrival')) {
            return 'LAX';
          }
          return 'SFO';
        }

        if (fieldName.includes('origin') || fieldName.includes('departure') || fieldName.includes('from')) {
          return 'SFO';
        }
        if (fieldName.includes('destination') || fieldName.includes('arrival')) {
          return 'LAX';
        }

        if (typeof schema.minLength === 'number' && schema.minLength > 0) {
          const size = Math.min(schema.minLength, 24);
          return 'a'.repeat(size);
        }

        return 'sample';
      }
      case 'number':
      case 'integer': {
        const fieldName = String(path[path.length - 1] || '').toLowerCase();
        if (typeof schema.minimum === 'number') return schema.minimum;
        if (typeof schema.exclusiveMinimum === 'number') {
          return schema.type === 'integer'
            ? Math.ceil(schema.exclusiveMinimum + 1)
            : schema.exclusiveMinimum + 0.1;
        }
        if (fieldName.includes('passenger') || fieldName.includes('count') || fieldName.includes('quantity')) {
          return 1;
        }
        return 1;
      }
      case 'boolean':
        return false;
      case 'null':
        return null;
      default:
        return {};
    }
  }

  getFutureDateISO(daysAhead = 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + daysAhead);
    return date.toISOString().slice(0, 10);
  }

  normalizeInputForSchema(schema, value, path = []) {
    if (!schema || typeof schema !== 'object') {
      return { value, changed: false };
    }

    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
      return this.normalizeInputForSchema(schema.oneOf[0], value, path);
    }

    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
      return this.normalizeInputForSchema(schema.anyOf[0], value, path);
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0 && !schema.enum.includes(value)) {
      return { value: schema.enum[0], changed: true };
    }

    if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
      return { value: schema.const, changed: true };
    }

    switch (schema.type) {
      case 'object': {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        let changed = !(value && typeof value === 'object' && !Array.isArray(value));
        const out = {};
        const properties = schema.properties || {};
        const required = new Set(Array.isArray(schema.required) ? schema.required : []);

        for (const [key, childSchema] of Object.entries(properties)) {
          if (source[key] === undefined && !required.has(key)) {
            continue;
          }
          const childResult = this.normalizeInputForSchema(childSchema, source[key], [...path, key]);
          out[key] = childResult.value;
          changed = changed || childResult.changed;
        }

        for (const [key, rawValue] of Object.entries(source)) {
          if (!Object.prototype.hasOwnProperty.call(out, key)) {
            out[key] = rawValue;
          }
        }

        return { value: out, changed };
      }
      case 'array': {
        const source = Array.isArray(value) ? value : [];
        let changed = !Array.isArray(value);

        if (!schema.items) {
          return { value: source, changed };
        }

        const normalizedItems = source.map((item, index) => {
          const result = this.normalizeInputForSchema(schema.items, item, [...path, String(index)]);
          changed = changed || result.changed;
          return result.value;
        });

        if (normalizedItems.length === 0 && (schema.minItems > 0 || value === undefined)) {
          normalizedItems.push(this.generateTemplateFromSchema(schema.items, [...path, '0']));
          changed = true;
        }

        return { value: normalizedItems, changed };
      }
      case 'string': {
        let next = typeof value === 'string' ? value : this.generateTemplateFromSchema(schema, path);
        let changed = typeof value !== 'string';

        if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
          next = this.generateTemplateFromSchema(schema, path);
          changed = true;
        }

        if (typeof schema.pattern === 'string') {
          try {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(next)) {
              next = this.generateTemplateFromSchema(schema, path);
              changed = true;
            }
          } catch {
            // ignore invalid pattern
          }
        }

        if (typeof schema.minLength === 'number' && next.length < schema.minLength) {
          next = next.padEnd(schema.minLength, 'a');
          changed = true;
        }

        if (typeof schema.maxLength === 'number' && next.length > schema.maxLength) {
          next = next.slice(0, schema.maxLength);
          changed = true;
        }

        return { value: next, changed };
      }
      case 'number':
      case 'integer': {
        let next = Number(value);
        let changed = !Number.isFinite(next);
        if (!Number.isFinite(next)) {
          next = Number(this.generateTemplateFromSchema(schema, path));
          changed = true;
        }

        if (schema.type === 'integer') {
          const rounded = Math.round(next);
          changed = changed || rounded !== next;
          next = rounded;
        }

        if (typeof schema.minimum === 'number' && next < schema.minimum) {
          next = schema.minimum;
          changed = true;
        }
        if (typeof schema.exclusiveMinimum === 'number' && next <= schema.exclusiveMinimum) {
          next = schema.type === 'integer'
            ? Math.ceil(schema.exclusiveMinimum + 1)
            : schema.exclusiveMinimum + 0.1;
          changed = true;
        }
        if (typeof schema.maximum === 'number' && next > schema.maximum) {
          next = schema.maximum;
          changed = true;
        }
        if (typeof schema.exclusiveMaximum === 'number' && next >= schema.exclusiveMaximum) {
          next = schema.type === 'integer'
            ? Math.floor(schema.exclusiveMaximum - 1)
            : schema.exclusiveMaximum - 0.1;
          changed = true;
        }

        return { value: next, changed };
      }
      case 'boolean':
        if (typeof value !== 'boolean') {
          return { value: false, changed: true };
        }
        return { value, changed: false };
      case 'null':
        return { value: null, changed: value !== null };
      default:
        if (value === undefined) {
          return { value: this.generateTemplateFromSchema(schema, path), changed: true };
        }
        return { value, changed: false };
    }
  }

  resetToolInputToTemplate() {
    if (!this.selectedTool) return;
    const schema = this.parseSchema(this.selectedTool.inputSchema);
    this.dom.toolInputArgs.value = JSON.stringify(this.generateTemplateFromSchema(schema, []), null, 2);
  }

  async copyCurrentToolInput() {
    try {
      await navigator.clipboard.writeText(this.dom.toolInputArgs.value || '{}');
      this.showStatus('Copied input JSON', 'success', 1500);
    } catch (error) {
      this.showStatus(`Clipboard failed: ${error.message}`, 'error', 3500);
    }
  }

  async copySelectedToolConfig() {
    if (!this.selectedTool) return;

    const payload = {
      name: this.selectedTool.name,
      description: this.selectedTool.description,
      inputSchema: this.parseSchema(this.selectedTool.inputSchema),
      annotations: this.selectedTool.annotations || {}
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      this.showStatus('Copied selected tool config', 'success', 1500);
    } catch (error) {
      this.showStatus(`Clipboard failed: ${error.message}`, 'error', 3500);
    }
  }

  async executeSelectedTool() {
    if (!this.selectedTool) return;

    this.dom.toolExecuteBtn.disabled = true;
    this.dom.toolExecutionResult.textContent = '';

    let inputArgs;
    try {
      inputArgs = JSON.parse(this.dom.toolInputArgs.value || '{}');
    } catch (error) {
      this.dom.toolExecutionResult.textContent = `Invalid JSON: ${error.message}`;
      this.dom.toolExecuteBtn.disabled = false;
      this.showStatus('Invalid tool input JSON', 'error', 3500);
      return;
    }

    const schema = this.parseSchema(this.selectedTool.inputSchema);
    const normalized = this.normalizeInputForSchema(schema, inputArgs, []);
    if (normalized.changed) {
      inputArgs = normalized.value;
      this.dom.toolInputArgs.value = JSON.stringify(inputArgs, null, 2);
      this.showStatus('Adjusted input to match schema constraints before execution.', 'warning', 3200);
    }

    const start = performance.now();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_TOOL',
        name: this.selectedTool.name,
        inputArgs
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      const elapsed = Math.round(performance.now() - start);
      const output = response?.result;
      this.dom.toolExecutionResult.textContent =
        typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);

      this.trace.push({
        ts: new Date().toISOString(),
        type: 'manual_execution',
        tool: this.selectedTool.name,
        input: inputArgs,
        result: output,
        elapsedMs: elapsed
      });

      this.showStatus(`Tool executed in ${elapsed}ms`, 'success', 2500);
    } catch (error) {
      this.dom.toolExecutionResult.textContent = `Execution failed: ${error.message}`;
      this.trace.push({
        ts: new Date().toISOString(),
        type: 'manual_execution_error',
        tool: this.selectedTool.name,
        input: inputArgs,
        error: error.message
      });
      this.showStatus('Tool execution failed', 'error', 3500);
    } finally {
      this.dom.toolExecuteBtn.disabled = false;
    }
  }

  appendChatLine(role, text) {
    const line = document.createElement('div');
    line.className = `chat-line ${role}`;
    line.textContent = text;
    this.dom.chatTranscript.appendChild(line);
    this.dom.chatTranscript.scrollTop = this.dom.chatTranscript.scrollHeight;
  }

  updateAIProviderLabel() {
    const providerName = aiManager.getCurrentProviderName();
    this.dom.aiProviderLabel.textContent = `Provider: ${providerName}`;
    this.dom.aiSendBtn.disabled = !aiManager.isReady();
  }

  resetAIConversation() {
    this.aiMessages = [];
    this.dom.chatTranscript.innerHTML = '';
    this.appendChatLine('system', 'Conversation reset.');
  }

  async sendAIMessage() {
    const userPrompt = this.dom.aiPromptInput.value.trim();
    if (!userPrompt) return;

    if (!aiManager.isReady()) {
      this.showStatus('Configure and enable an AI provider in Settings first.', 'warning', 4500);
      this.setActiveTab('settings');
      return;
    }

    this.dom.aiSendBtn.disabled = true;
    this.dom.aiPromptInput.value = '';

    this.aiMessages.push({ role: 'user', content: userPrompt });
    this.appendChatLine('user', userPrompt);

    this.trace.push({
      ts: new Date().toISOString(),
      type: 'ai_user_prompt',
      prompt: userPrompt
    });

    try {
      await this.runAIAgentLoop();
    } catch (error) {
      this.appendChatLine('system', `AI error: ${error.message}`);
      this.trace.push({ ts: new Date().toISOString(), type: 'ai_error', error: error.message });
    } finally {
      this.dom.aiSendBtn.disabled = !aiManager.isReady();
    }
  }

  stableStringify(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return 'null';

    const valueType = typeof value;
    if (valueType === 'string') return JSON.stringify(value);
    if (valueType === 'number' || valueType === 'boolean') return String(value);
    if (valueType !== 'object') return JSON.stringify(String(value));

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item, seen)).join(',')}]`;
    }

    if (seen.has(value)) {
      return '"[Circular]"';
    }

    seen.add(value);
    const keys = Object.keys(value).sort();
    const out = keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(value[key], seen)}`);
    seen.delete(value);
    return `{${out.join(',')}}`;
  }

  buildToolCallSignature(toolName, args) {
    return `${String(toolName || '')}::${this.stableStringify(args)}`;
  }

  async runAIAgentLoop() {
    const maxTurns = 5;
    const executedToolCalls = new Map();
    let toolsEnabled = true;

    for (let turn = 0; turn < maxTurns; turn += 1) {
      const aiResponse = await aiManager.sendMessage(this.aiMessages, toolsEnabled ? this.tools : []);

      if (aiResponse?.error) {
        throw new Error(aiResponse.error);
      }

      const text = (aiResponse?.text || '').trim();
      const functionCalls = Array.isArray(aiResponse?.functionCalls) ? aiResponse.functionCalls : [];

      if (text) {
        this.aiMessages.push({ role: 'assistant', content: text });
        this.appendChatLine('assistant', text);
        this.trace.push({ ts: new Date().toISOString(), type: 'ai_text', text });
      }

      if (functionCalls.length === 0) {
        return;
      }

      const toolResultLines = [];
      let executedThisTurn = 0;
      let skippedDuplicatesThisTurn = 0;

      for (const call of functionCalls) {
        const toolName = call?.name || '(unknown_tool)';
        const rawArgs = call?.args;
        let args = rawArgs;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          args = {};
        }

        const callSignature = this.buildToolCallSignature(toolName, args);
        const existingCall = executedToolCalls.get(callSignature);
        if (existingCall?.status === 'success') {
          skippedDuplicatesThisTurn += 1;
          const duplicateLine = `${toolName}(${JSON.stringify(args)}) => SKIPPED: duplicate of a successful previous call`;
          toolResultLines.push(duplicateLine);
          this.trace.push({
            ts: new Date().toISOString(),
            type: 'ai_tool_skipped_duplicate',
            tool: toolName,
            args
          });
          continue;
        }

        const toolDef = this.tools.find((tool) => tool.name === toolName);
        if (toolDef) {
          const schema = this.parseSchema(toolDef.inputSchema);
          const normalized = this.normalizeInputForSchema(schema, args, []);
          if (normalized.changed) {
            args = normalized.value;
            this.trace.push({
              ts: new Date().toISOString(),
              type: 'ai_tool_args_normalized',
              tool: toolName,
              args
            });
          }
        }

        this.appendChatLine('system', `Calling tool: ${toolName}`);

        try {
          const execResponse = await chrome.runtime.sendMessage({
            type: 'EXECUTE_TOOL',
            name: toolName,
            inputArgs: args
          });

          if (execResponse?.error) {
            throw new Error(execResponse.error);
          }

          const result = execResponse?.result;
          toolResultLines.push(
            `${toolName}(${JSON.stringify(args)}) => ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`
          );
          executedThisTurn += 1;
          executedToolCalls.set(callSignature, { status: 'success' });

          this.trace.push({
            ts: new Date().toISOString(),
            type: 'ai_tool_result',
            tool: toolName,
            args,
            result
          });
        } catch (error) {
          const line = `${toolName}(${JSON.stringify(args)}) => ERROR: ${error.message}`;
          toolResultLines.push(line);
          executedToolCalls.set(callSignature, { status: 'error' });
          this.trace.push({
            ts: new Date().toISOString(),
            type: 'ai_tool_error',
            tool: toolName,
            args,
            error: error.message
          });
        }
      }

      if (executedThisTurn === 0 && skippedDuplicatesThisTurn > 0) {
        toolsEnabled = false;
        const guardMessage =
          'You are repeating identical tool calls that already succeeded. ' +
          'Do not call tools again for this request. Use prior results and provide the final answer.';
        this.aiMessages.push({ role: 'user', content: guardMessage });
        this.appendChatLine('system', 'Duplicate tool-call loop detected. Asking AI for final answer without more tool calls.');
        this.trace.push({
          ts: new Date().toISOString(),
          type: 'ai_loop_guard_triggered',
          skippedDuplicates: skippedDuplicatesThisTurn
        });
        continue;
      }

      const toolSummary =
        `Tool call results:\n${toolResultLines.join('\n')}\n\n` +
        'Continue the task. Do not repeat a tool call with identical arguments if it already succeeded.';
      this.aiMessages.push({ role: 'user', content: toolSummary });
      this.appendChatLine('system', 'Tool results sent back to AI.');
    }

    this.appendChatLine('system', 'Stopped after max AI turns to avoid loops.');
  }

  async copyTrace() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.trace, null, 2));
      this.showStatus('Trace copied', 'success', 1500);
    } catch (error) {
      this.showStatus(`Trace copy failed: ${error.message}`, 'error', 3500);
    }
  }

  loadGeneralSettingsIntoUI() {
    this.dom.settingTheme.value = settingsManager.get('general.theme') || 'system';
    this.dom.settingAutoOpen.checked = !!settingsManager.get('general.autoOpen');
    this.dom.settingNotifications.checked = !!settingsManager.get('general.notifications');
    this.applyThemeSetting(this.dom.settingTheme.value);
  }

  async saveGeneralSettings() {
    try {
      await settingsManager.set('general.theme', this.dom.settingTheme.value);
      await settingsManager.set('general.autoOpen', this.dom.settingAutoOpen.checked);
      await settingsManager.set('general.notifications', this.dom.settingNotifications.checked);
      this.applyThemeSetting(this.dom.settingTheme.value);
      this.showStatus('General settings saved', 'success', 2200);
    } catch (error) {
      this.showStatus(`Failed to save settings: ${error.message}`, 'error', 4000);
    }
  }

  applyThemeSetting(theme) {
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') document.documentElement.classList.add('theme-light');
    if (theme === 'dark') document.documentElement.classList.add('theme-dark');
  }

  renderProviderCards() {
    this.dom.providerCards.innerHTML = '';

    const providers = aiManager.getAllProviders();
    const defaultProvider = settingsManager.get('ai.defaultProvider');

    for (const provider of providers) {
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.style.borderLeft = `4px solid ${PROVIDER_COLORS[provider.id] || '#94a3b8'}`;
      if (provider.id === defaultProvider) {
        card.classList.add('active');
      }

      const main = document.createElement('div');
      main.className = 'provider-card-main';

      const name = document.createElement('div');
      name.className = 'provider-name';
      name.textContent = `${provider.icon || '•'} ${provider.name}`;

      const meta = document.createElement('div');
      meta.className = 'provider-meta';
      const status = provider.enabled ? 'Enabled' : 'Disabled';
      const model = provider.config?.model ? ` • ${provider.config.model}` : '';
      const defaultBadge = provider.id === defaultProvider ? ' • Default' : '';
      meta.textContent = `${status}${model}${defaultBadge}`;

      main.appendChild(name);
      main.appendChild(meta);

      const button = document.createElement('button');
      button.className = 'btn btn-secondary btn-small';
      button.textContent = 'Configure';
      button.addEventListener('click', () => this.openProviderEditor(provider.id));

      card.appendChild(main);
      card.appendChild(button);
      this.dom.providerCards.appendChild(card);
    }
  }

  openProviderEditor(providerId) {
    this.currentProviderId = providerId;

    const provider = aiManager.getProvider(providerId);
    if (!provider) {
      this.showProviderStatus('Provider not found', 'error');
      return;
    }

    this.dom.providerEditorTitle.textContent = `${provider.name} Configuration`;

    this.dom.providerApiKey.value = provider.config?.apiKey || '';
    this.dom.providerServerUrl.value = provider.config?.serverUrl || 'http://127.0.0.1:11434';
    this.dom.providerOrganization.value = provider.config?.organization || '';
    this.dom.providerTemperature.value = String(provider.config?.temperature ?? 0.7);
    this.dom.providerMaxTokens.value = String(provider.config?.maxTokens ?? 2048);
    this.dom.providerSystemPrompt.value = provider.config?.systemPrompt || '';

    this.fillModelSelect(provider.models || [], provider.config?.model || '');
    this.toggleProviderFieldVisibility(providerId);

    this.dom.providerRefreshModelsBtn.disabled = false;
    this.dom.providerTestBtn.disabled = false;
    this.dom.providerSaveBtn.disabled = false;
    this.dom.providerSaveDefaultBtn.disabled = false;
    this.dom.providerDisableBtn.disabled = false;

    this.showProviderStatus('', 'info');
  }

  toggleProviderFieldVisibility(providerId) {
    const isOllama = providerId === 'ollama';
    const isOpenAI = providerId === 'openai';

    this.setFieldVisible(this.dom.providerApiKey, !isOllama);
    this.setFieldVisible(this.dom.providerServerUrl, isOllama);
    this.setFieldVisible(this.dom.providerOrganization, isOpenAI);
  }

  setFieldVisible(element, visible) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    element.classList.toggle('hidden', !visible);
    if (label) label.classList.toggle('hidden', !visible);
  }

  fillModelSelect(models, currentModel) {
    this.dom.providerModelSelect.innerHTML = '';

    const normalized = Array.isArray(models) ? models : [];
    if (normalized.length === 0 && currentModel) {
      normalized.push({ id: currentModel, name: currentModel });
    }

    if (normalized.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models loaded. Click Refresh Models.';
      this.dom.providerModelSelect.appendChild(option);
      return;
    }

    for (const model of normalized) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      this.dom.providerModelSelect.appendChild(option);
    }

    if (currentModel) {
      this.dom.providerModelSelect.value = currentModel;
    }
  }

  prepareModelsForStorage(providerId, models, preferredModel = '') {
    const input = Array.isArray(models) ? models : [];
    const seen = new Set();
    const normalized = [];

    for (const model of input) {
      const id = String(model?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      normalized.push({
        id,
        name: String(model?.name || id).slice(0, 120),
        description: String(model?.description || '').slice(0, 200)
      });
    }

    const maxModels = providerId === 'openai' ? 24 : 60;
    let out = normalized.slice(0, maxModels);

    const preferred = String(preferredModel || '').trim();
    if (preferred && !out.some((entry) => entry.id === preferred)) {
      const existing = normalized.find((entry) => entry.id === preferred) || {
        id: preferred,
        name: preferred,
        description: ''
      };
      out = [existing, ...out.slice(0, Math.max(0, maxModels - 1))];
    }

    return out;
  }

  buildProviderConfigFromEditor() {
    const providerId = this.currentProviderId;
    const existing = aiManager.getProvider(providerId);
    const config = { ...(existing?.config || {}) };

    config.model = this.dom.providerModelSelect.value || config.model || '';
    config.temperature = Number(this.dom.providerTemperature.value || config.temperature || 0.7);
    config.maxTokens = Number(this.dom.providerMaxTokens.value || config.maxTokens || 2048);
    config.systemPrompt = this.dom.providerSystemPrompt.value || config.systemPrompt || '';

    if (providerId === 'ollama') {
      config.serverUrl = this.dom.providerServerUrl.value || 'http://127.0.0.1:11434';
      delete config.apiKey;
      delete config.organization;
    } else {
      config.apiKey = this.dom.providerApiKey.value.trim();
      if (providerId === 'openai') {
        config.organization = this.dom.providerOrganization.value.trim();
      } else {
        delete config.organization;
      }
      delete config.serverUrl;
    }

    return config;
  }

  async refreshProviderModels() {
    if (!this.currentProviderId) return;

    this.dom.providerRefreshModelsBtn.disabled = true;
    this.showProviderStatus('Fetching available models...', 'info');

    try {
      const draftConfig = this.buildProviderConfigFromEditor();
      await aiManager.updateProvider(this.currentProviderId, { config: draftConfig });

      const models = await aiManager.getModels(this.currentProviderId);
      if (!Array.isArray(models) || models.length === 0) {
        this.showProviderStatus('No models returned. Verify credentials/server and retry.', 'warning');
      } else {
        const currentModel = this.dom.providerModelSelect.value || draftConfig.model;
        const modelsForStorage = this.prepareModelsForStorage(this.currentProviderId, models, currentModel);

        try {
          await aiManager.updateProvider(this.currentProviderId, { models: modelsForStorage });
        } catch (storageError) {
          if (/quota/i.test(String(storageError?.message || ''))) {
            const minimal = this.prepareModelsForStorage(
              this.currentProviderId,
              modelsForStorage,
              currentModel
            ).slice(0, 10);
            await aiManager.updateProvider(this.currentProviderId, { models: minimal });
          } else {
            throw storageError;
          }
        }

        this.fillModelSelect(models, currentModel);
        const storedCount = modelsForStorage.length;
        const suffix = storedCount < models.length
          ? ` (stored ${storedCount} locally to fit Chrome sync limits).`
          : '.';
        this.showProviderStatus(`Loaded ${models.length} model${models.length === 1 ? '' : 's'}${suffix}`, 'success');
      }
    } catch (error) {
      this.showProviderStatus(`Model refresh failed: ${error.message}`, 'error');
    } finally {
      this.dom.providerRefreshModelsBtn.disabled = false;
      this.renderProviderCards();
    }
  }

  async testProviderConnection() {
    if (!this.currentProviderId) return;

    this.dom.providerTestBtn.disabled = true;
    this.showProviderStatus('Testing provider connection...', 'info');

    try {
      const draftConfig = this.buildProviderConfigFromEditor();
      const ProviderClass = aiManager.getProviderClass(this.currentProviderId);
      if (!ProviderClass) throw new Error('Provider class not found');

      const provider = new ProviderClass(draftConfig);
      const result = await provider.testConnection();
      if (result.success) {
        this.showProviderStatus('Connection successful.', 'success');
      } else {
        this.showProviderStatus(`Connection failed: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      this.showProviderStatus(`Connection test failed: ${error.message}`, 'error');
    } finally {
      this.dom.providerTestBtn.disabled = false;
    }
  }

  async saveProvider(setAsDefault) {
    if (!this.currentProviderId) return;

    this.dom.providerSaveBtn.disabled = true;
    this.dom.providerSaveDefaultBtn.disabled = true;

    try {
      const config = this.buildProviderConfigFromEditor();

      await aiManager.updateProvider(this.currentProviderId, {
        enabled: true,
        config
      });

      if (setAsDefault) {
        await aiManager.switchProvider(this.currentProviderId);
      } else {
        await aiManager.loadProvider();
      }

      this.renderProviderCards();
      this.updateAIProviderLabel();
      this.showProviderStatus(
        setAsDefault ? 'Provider saved and set as default.' : 'Provider saved successfully.',
        'success'
      );
      this.showStatus('Provider settings updated', 'success', 2200);
    } catch (error) {
      this.showProviderStatus(`Failed to save provider: ${error.message}`, 'error');
      this.showStatus('Provider save failed', 'error', 3500);
    } finally {
      this.dom.providerSaveBtn.disabled = false;
      this.dom.providerSaveDefaultBtn.disabled = false;
    }
  }

  async disableProvider() {
    if (!this.currentProviderId) return;

    try {
      await aiManager.toggleProvider(this.currentProviderId, false);

      const defaultProvider = settingsManager.get('ai.defaultProvider');
      if (defaultProvider === this.currentProviderId) {
        const enabled = settingsManager.getEnabledProviders();
        if (enabled.length > 0) {
          await settingsManager.set('ai.defaultProvider', enabled[0].id);
        }
      }

      await aiManager.loadProvider();
      this.renderProviderCards();
      this.updateAIProviderLabel();
      this.showProviderStatus('Provider disabled.', 'warning');
      this.showStatus('Provider disabled', 'warning', 2200);
    } catch (error) {
      this.showProviderStatus(`Failed to disable provider: ${error.message}`, 'error');
    }
  }

  showProviderStatus(message, type = 'info') {
    if (!message) {
      this.dom.providerStatus.hidden = true;
      this.dom.providerStatus.textContent = '';
      this.dom.providerStatus.className = 'status-inline';
      return;
    }

    this.dom.providerStatus.hidden = false;
    this.dom.providerStatus.textContent = message;
    this.dom.providerStatus.className = `status-inline ${type}`;
  }
}

const app = new SidePanelApp();
document.addEventListener('DOMContentLoaded', () => {
  app.init().catch((error) => {
    console.error('[Sidebar] Failed to initialize app:', error);
  });
});
