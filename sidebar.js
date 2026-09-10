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
    this.declarativeDiagnostics = [];
    this.apis = [];
    this.selectedTool = null;
    this.currentTabId = null;
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

    // Prevent MV3 service worker suspension while the sidebar is open.
    // Chrome suspends after ~30 s of inactivity; pinging every 25 s keeps it alive.
    this._keepaliveTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'KEEPALIVE' }).catch(() => {});
    }, 25_000);
    window.addEventListener('beforeunload', () => {
      if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    });

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
      this.selectToolById(selectedTool);
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
          this.handleToolsUpdate(message);
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
        this.handleToolsUpdate(response);
        this.setContext(response.url || '', false);
        this.showStatus(response.error, 'warning', 5000);
        return;
      }

      const tools = Array.isArray(response?.tools) ? response.tools : [];
      const url = response?.url || '';
      this.handleToolsUpdate(response);
      const warning = Array.isArray(response?.warnings) && response.warnings.length ? ` (${response.warnings.join('; ')})` : '';
      this.showStatus(`Loaded ${tools.length} registered tool${tools.length === 1 ? '' : 's'}${warning}`, warning ? 'warning' : 'success', warning ? 6000 : 2500);
    } catch (error) {
      this.showStatus(`Failed to load tools: ${error.message}`, 'error', 6000);
    }
  }

  handleToolsUpdate(snapshot) {
    const tools = Array.isArray(snapshot?.tools) ? snapshot.tools : [];
    const url = snapshot?.url || '';
    this.currentTabId = Number.isInteger(snapshot?.tabId) ? snapshot.tabId : this.currentTabId;
    this.tools = tools;
    this.declarativeDiagnostics = Array.isArray(snapshot?.declarativeDiagnostics) ? snapshot.declarativeDiagnostics : [];
    this.apis = Array.isArray(snapshot?.apis) ? snapshot.apis : [];
    this.dom.tabToolCount.textContent = String(tools.length);
    this.setContext(url, Boolean(snapshot?.apiAvailable));

    this.renderToolLists();

    if (!this.selectedTool && tools.length > 0) {
      this.selectTool(tools[0]);
    } else if (this.selectedTool) {
      const updated = [...tools, ...this.declarativeDiagnostics].find((tool) => tool.id === this.selectedTool.id);
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
    const filtered = [...this.tools, ...this.declarativeDiagnostics].filter((tool) => {
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
      button.classList.toggle('active', this.selectedTool?.id === tool.id);

      const name = document.createElement('div');
      name.className = 'tool-item-name';
      name.textContent = tool.name || '(unnamed_tool)';

      const desc = document.createElement('div');
      desc.className = 'tool-item-desc';
      desc.textContent = tool.description || 'No description';

      const meta = document.createElement('div');
      meta.className = 'tool-item-meta';
      meta.textContent = this.isDeclarativeTool(tool)
        ? 'Declarative markup (diagnostic only)'
        : `${tool.apiFlavor || 'WebMCP'} · ${tool.origin || 'current origin'} · ${tool.framePath || 'top'}`;

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

  selectToolById(id) {
    const found = [...this.tools, ...this.declarativeDiagnostics].find((tool) => tool.id === id);
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
    this.dom.selectedToolDescription.textContent = tool.schemaError || tool.diagnostic || tool.description || 'No description';
    this.dom.selectedToolType.textContent = this.isDeclarativeTool(tool)
      ? 'Declarative (HTML Form)'
      : 'Imperative (JavaScript)';

    const readOnlyHint = tool?.annotations?.readOnlyHint;
    this.dom.selectedToolReadOnly.textContent =
      readOnlyHint === true ? 'Yes' : readOnlyHint === false ? 'No' : 'Unknown';

    this.dom.selectedToolSource.textContent = [
      tool.apiFlavor || tool.source || (this.isDeclarativeTool(tool) ? 'HTML Form' : 'JavaScript'),
      tool.origin,
      tool.framePath
    ].filter(Boolean).join(' · ');

    const schema = this.parseSchema(tool.inputSchema);
    this.dom.selectedToolSchema.textContent = JSON.stringify(schema, null, 2);

    this.dom.toolInputArgs.value = JSON.stringify(this.generateTemplateFromSchema(schema, []), null, 2);
    this.dom.toolExecutionResult.textContent = '';

    this.toggleToolActions(true, tool.executable !== false);
  }

  toggleToolActions(enabled, executable = enabled) {
    this.dom.toolInputArgs.disabled = !enabled;
    this.dom.toolInputResetBtn.disabled = !enabled;
    this.dom.toolCopyJsonBtn.disabled = !enabled;
    this.dom.toolExecuteBtn.disabled = !executable;
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

  validateInputForSchema(schema, value, path = '$') {
    if (!schema || typeof schema !== 'object') return [];
    const errors = [];
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate) => this.validateInputForSchema(candidate, value, path).length === 0)) {
      errors.push(`${path} does not match any allowed schema`);
      return errors;
    }
    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter((candidate) => this.validateInputForSchema(candidate, value, path).length === 0).length;
      if (matches !== 1) errors.push(`${path} must match exactly one allowed schema (matched ${matches})`);
    }
    if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);

    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const typeMatches = (type) => ({
      object: value !== null && typeof value === 'object' && !Array.isArray(value),
      array: Array.isArray(value),
      string: typeof value === 'string',
      number: typeof value === 'number' && Number.isFinite(value),
      integer: Number.isInteger(value),
      boolean: typeof value === 'boolean',
      null: value === null
    })[type] === true;
    if (types.length && !types.some(typeMatches)) {
      errors.push(`${path} must be ${types.join(' or ')}`);
      return errors;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
      for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
      for (const [key, child] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) errors.push(...this.validateInputForSchema(child, value[key], `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    if (Array.isArray(value)) {
      if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
      if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} items`);
      if (schema.items) value.forEach((entry, index) => errors.push(...this.validateInputForSchema(schema.items, entry, `${path}[${index}]`)));
    }
    if (typeof value === 'string') {
      if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
      if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`);
      if (typeof schema.pattern === 'string') {
        try { if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match ${schema.pattern}`); }
        catch { errors.push(`${path} uses an invalid schema pattern`); }
      }
      if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`${path} must use YYYY-MM-DD`);
    }
    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) errors.push(`${path} must be < ${schema.exclusiveMaximum}`);
    }
    return errors;
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
    const validationErrors = this.validateInputForSchema(schema, inputArgs);
    if (validationErrors.length) {
      this.dom.toolExecutionResult.textContent = `Input does not match the tool schema:\n- ${validationErrors.join('\n- ')}`;
      this.dom.toolExecuteBtn.disabled = false;
      this.showStatus('Tool input failed schema validation; it was not changed or executed.', 'error', 5000);
      return;
    }
    if (this.selectedTool?.annotations?.consequentialHint === true) {
      const approved = window.confirm(`This tool is marked consequential:\n\n${this.selectedTool.name}\n${JSON.stringify(inputArgs, null, 2)}\n\nExecute it?`);
      if (!approved) {
        this.dom.toolExecuteBtn.disabled = false;
        this.showStatus('Consequential tool execution canceled.', 'warning', 3000);
        return;
      }
    }

    if (!Number.isInteger(this.currentTabId)) {
      await this.refreshTools(false);
    }

    const start = performance.now();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_TOOL',
        tabId: this.currentTabId,
        toolId: this.selectedTool.id,
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

    // If the last message in history is already a user message, coalesce or ensure alternating turns
    if (this.aiMessages.length > 0 && this.aiMessages[this.aiMessages.length - 1].role === 'user') {
      this.aiMessages[this.aiMessages.length - 1].content += `\n\n${userPrompt}`;
    } else {
      this.aiMessages.push({ role: 'user', content: userPrompt });
    }
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
      const availableTools = toolsEnabled ? this.tools.filter((tool) => tool.executable !== false && !tool.schemaError) : [];
      const aiResponse = await aiManager.sendMessage(this.aiMessages, availableTools);

      if (aiResponse?.error) {
        throw new Error(aiResponse.error);
      }

      const text = (aiResponse?.text || '').trim();
      const toolCalls = Array.isArray(aiResponse?.toolCalls)
        ? aiResponse.toolCalls
        : Array.isArray(aiResponse?.functionCalls) ? aiResponse.functionCalls : [];
      const assistantMessage = aiResponse.assistantMessage || { role: 'assistant', content: text, toolCalls };
      this.aiMessages.push(assistantMessage);

      if (text) {
        this.appendChatLine('assistant', text);
        this.trace.push({ ts: new Date().toISOString(), type: 'ai_text', text });
      }

      if (toolCalls.length === 0) return;

      let executedThisTurn = 0;
      let skippedDuplicatesThisTurn = 0;

      for (const call of toolCalls) {
        const toolName = call?.name || '(unknown_tool)';
        const args = call?.args;
        const sameNameTools = this.tools.filter((tool) => tool.name === toolName);
        const toolDef = this.tools.find((tool) => tool.id === call?.toolId) ||
          (sameNameTools.length === 1 ? sameNameTools[0] : null);
        let resultContent;
        let isError = false;

        const callSignature = this.buildToolCallSignature(toolName, args);
        const existingCall = executedToolCalls.get(callSignature);
        if (existingCall?.status === 'success') {
          skippedDuplicatesThisTurn += 1;
          resultContent = { error: 'Skipped duplicate of a successful previous call', duplicate: true };
          isError = true;
          this.trace.push({
            ts: new Date().toISOString(),
            type: 'ai_tool_skipped_duplicate',
            tool: toolName,
            args
          });
        } else if (!toolsEnabled) {
          resultContent = { error: 'Tool execution was disabled by the duplicate-call loop guard' };
          isError = true;
        } else if (call?.parseError) {
          resultContent = { error: call.parseError };
          isError = true;
        } else if (!toolDef) {
          resultContent = { error: `Unknown or ambiguous tool: ${toolName}` };
          isError = true;
        } else if (!args || typeof args !== 'object' || Array.isArray(args)) {
          resultContent = { error: 'Tool arguments must be a JSON object' };
          isError = true;
        } else {
          const schema = this.parseSchema(toolDef.inputSchema);
          const validationErrors = this.validateInputForSchema(schema, args);
          if (validationErrors.length) {
            resultContent = { error: 'Arguments failed schema validation', validationErrors };
            isError = true;
          } else if (toolDef?.annotations?.consequentialHint === true && !window.confirm(`AI requests a consequential tool:\n\n${toolDef.name}\n${JSON.stringify(args, null, 2)}\n\nExecute it?`)) {
            resultContent = { error: 'User declined consequential tool execution' };
            isError = true;
          } else {
            this.appendChatLine('system', `Calling tool: ${toolName}`);
            try {
              if (!Number.isInteger(this.currentTabId)) {
                await this.refreshTools(false);
              }
              const execResponse = await chrome.runtime.sendMessage({
                type: 'EXECUTE_TOOL',
                tabId: this.currentTabId,
                toolId: toolDef.id,
                inputArgs: args
              });
              if (execResponse?.error) throw new Error(execResponse.error);
              resultContent = execResponse?.result;
              executedThisTurn += 1;
              executedToolCalls.set(callSignature, { status: 'success' });
              this.trace.push({ ts: new Date().toISOString(), type: 'ai_tool_result', toolId: toolDef.id, tool: toolName, args, result: resultContent });
            } catch (error) {
              resultContent = { error: error.message };
              isError = true;
              executedToolCalls.set(callSignature, { status: 'error' });
              this.trace.push({ ts: new Date().toISOString(), type: 'ai_tool_error', toolId: toolDef.id, tool: toolName, args, error: error.message });
            }
          }
        }
        this.aiMessages.push({
          role: 'tool',
          toolCallId: call.id,
          name: toolName,
          providerName: call.providerName || toolName,
          content: resultContent,
          isError,
          untrusted: true
        });
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
      }
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
    this.applyThemeSetting(this.dom.settingTheme.value);
  }

  async saveGeneralSettings() {
    try {
      await settingsManager.set('general.theme', this.dom.settingTheme.value);
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
