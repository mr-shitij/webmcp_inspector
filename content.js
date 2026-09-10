(() => {
  /**
   * Copyright 2026 Google LLC
   * SPDX-License-Identifier: Apache-2.0
   *
   * WebMCP page bridge. The standards surface is document.modelContext.
   * navigator.modelContextTesting is a labeled Chromium compatibility adapter
   * and never shadows the standards surface.
   */

  if (window.__webmcpInspectorInjected) return;
  window.__webmcpInspectorInjected = true;

  const discoveredTools = new Map();
  const listenedApis = new WeakSet();
  const pageInstanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let domObserver = null;
  let changeNotificationTimer = null;

  function isTopFrame() {
    try { return window.top === window; } catch { return false; }
  }

  function errorMessage(error) {
    if (!error) return 'Unknown error';
    const name = typeof error.name === 'string' ? error.name : '';
    const message = typeof error.message === 'string' ? error.message : String(error);
    return name && message ? `${name}: ${message}` : message;
  }

  function isInvalidated(error) {
    return /extension context invalidated/i.test(errorMessage(error));
  }

  function toSerializable(value, depth = 0, seen = new WeakSet()) {
    if (value === null) return null;
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'bigint') return String(value);
    if (['undefined', 'function', 'symbol'].includes(typeof value)) return undefined;
    if (depth > 8) return '[MaxDepth]';
    if (Array.isArray(value)) {
      return value.map((item) => toSerializable(item, depth + 1, seen)).filter((item) => item !== undefined);
    }
    if (typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      const result = {};
      for (const key of Object.keys(value)) {
        let nested;
        try { nested = value[key]; } catch { continue; }
        const serialized = toSerializable(nested, depth + 1, seen);
        if (serialized !== undefined) result[key] = serialized;
      }
      seen.delete(value);
      return result;
    }
    return undefined;
  }

  function sendRuntimeMessage(message) {
    try {
      const promise = globalThis.chrome?.runtime?.sendMessage?.(message);
      promise?.catch?.(() => {});
    } catch (error) {
      if (!isInvalidated(error)) console.debug('[WebMCP Inspector] Message failed:', error);
    }
  }

  function replySafely(reply, value) {
    try { reply?.(value); } catch (error) {
      if (!isInvalidated(error)) console.debug('[WebMCP Inspector] Reply failed:', error);
    }
  }

  function getAdapters() {
    const adapters = [];
    const seen = new Set();
    const add = (api, flavor, standard, listMethod, executeMode) => {
      if (!api || seen.has(api) || typeof api[listMethod] !== 'function') return;
      seen.add(api);
      adapters.push({ api, flavor, standard, listMethod, executeMode });
    };
    try { add(document.modelContext, 'document.modelContext', true, 'getTools', 'registered-tool'); } catch {}
    try { add(navigator.modelContextTesting, 'navigator.modelContextTesting', false, 'listTools', 'name-json'); } catch {}
    return adapters;
  }

  function capabilities(api) {
    return ['getTools', 'listTools', 'executeTool', 'addEventListener', 'registerToolsChangedCallback']
      .filter((name) => {
        try { return typeof api?.[name] === 'function'; } catch { return false; }
      });
  }

  function parseSchema(schema) {
    if (schema === undefined || schema === null) {
      return { schema: { type: 'object', properties: {} }, error: null };
    }
    let parsed = schema;
    if (typeof schema === 'string') {
      try { parsed = JSON.parse(schema); }
      catch (error) { return { schema: null, error: `Invalid JSON inputSchema: ${errorMessage(error)}` }; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { schema: null, error: 'inputSchema must be a JSON object' };
    }
    return { schema: toSerializable(parsed), error: null };
  }

  function safeOrigin(value) {
    try { return new URL(String(value), location.href).origin; } catch { return location.origin || ''; }
  }

  function framePathFor(targetWindow) {
    if (!targetWindow || targetWindow === window) return 'top';
    const search = (parent, prefix, depth) => {
      if (depth > 8) return null;
      let length = 0;
      try { length = parent.frames.length; } catch { return null; }
      for (let index = 0; index < length; index += 1) {
        let child;
        try { child = parent.frames[index]; } catch { continue; }
        const path = `${prefix}.${index}`;
        if (child === targetWindow) return path;
        const nested = search(child, path, depth + 1);
        if (nested) return nested;
      }
      return null;
    };
    return search(window, 'top', 0) || 'descendant';
  }

  function normalizeTool(rawTool, adapter) {
    const name = typeof rawTool?.name === 'string' && rawTool.name ? rawTool.name : '(unnamed_tool)';
    const origin = safeOrigin(rawTool?.origin || location.origin || location.href);
    const framePath = adapter.standard ? framePathFor(rawTool?.window) : 'compatibility';
    const id = `${adapter.flavor}|${origin}|${framePath}|${name}`;
    const { schema, error } = parseSchema(rawTool?.inputSchema);
    return {
      id,
      name,
      title: typeof rawTool?.title === 'string' ? rawTool.title : '',
      description: typeof rawTool?.description === 'string' ? rawTool.description : '',
      inputSchema: schema,
      schemaError: error || undefined,
      annotations: rawTool?.annotations && typeof rawTool.annotations === 'object'
        ? toSerializable(rawTool.annotations)
        : undefined,
      origin,
      framePath,
      apiFlavor: adapter.flavor,
      standardsCompliant: adapter.standard,
      executable: Boolean(name !== '(unnamed_tool)' && !error && typeof adapter.api.executeTool === 'function')
    };
  }

  async function readAdapterTools(adapter, fromOrigins) {
    try {
      let value;
      if (adapter.listMethod === 'getTools') {
        value = fromOrigins.length > 0
          ? await adapter.api.getTools({ fromOrigins })
          : await adapter.api.getTools();
      } else {
        value = await adapter.api.listTools();
      }
      return { rawTools: Array.isArray(value) ? value : [], error: null };
    } catch (error) {
      return { rawTools: [], error: errorMessage(error) };
    }
  }

  function declarativeDiagnostics() {
    const diagnostics = [];
    let forms = [];
    try { forms = Array.from(document.querySelectorAll?.('form[toolname]') || []); } catch {}
    forms.forEach((form, index) => {
      const name = form.getAttribute?.('toolname') || '';
      if (!name) return;
      const properties = {};
      const required = [];
      for (const control of Array.from(form.elements || [])) {
        const parameterName = control?.name;
        const tag = String(control?.tagName || '').toLowerCase();
        const type = String(control?.type || '').toLowerCase();
        if (!parameterName || tag === 'button' || ['submit', 'reset', 'button'].includes(type)) continue;
        const property = { type: ['number', 'range'].includes(type) ? 'number' : type === 'checkbox' ? 'boolean' : 'string' };
        const description = control.getAttribute?.('toolparamdescription');
        if (description) property.description = description;
        properties[parameterName] = property;
        if (control.required) required.push(parameterName);
      }
      diagnostics.push({
        id: `declarative-diagnostic|${location.origin || ''}|top|${name}|${index}`,
        name,
        description: form.getAttribute?.('tooldescription') || '',
        inputSchema: { type: 'object', properties, required },
        origin: location.origin || '',
        framePath: 'top',
        apiFlavor: 'declarative-markup-diagnostic',
        type: 'declarative',
        kind: 'form',
        source: 'form[toolname]',
        autoSubmit: form.hasAttribute?.('toolautosubmit') || false,
        executable: false,
        diagnostic: 'Declarative markup is shown for inspection only; execution must be exposed by the browser WebMCP API.'
      });
    });
    return diagnostics;
  }

  async function listTools(fromOrigins = []) {
    if (!isTopFrame()) return { success: true, ignored: 'non-top-frame', tools: [], apis: [] };
    installListeners();
    const isAllowedOrigin = (origin) => {
      try {
        const parsed = new URL(origin);
        const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
        return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback);
      } catch { return false; }
    };
    const allowedOrigins = Array.isArray(fromOrigins)
      ? [...new Set(fromOrigins.filter((origin) => typeof origin === 'string' && isAllowedOrigin(origin)))]
      : [];
    const adapters = getAdapters();
    const apiReports = [];
    const standardNames = new Set();
    const collected = [];
    discoveredTools.clear();

    for (const adapter of adapters) {
      const { rawTools, error } = await readAdapterTools(adapter, allowedOrigins);
      apiReports.push({
        flavor: adapter.flavor,
        standard: adapter.standard,
        capabilities: capabilities(adapter.api),
        toolCount: rawTools.length,
        error: error || undefined
      });
      rawTools.forEach((rawTool, index) => {
        const normalized = normalizeTool(rawTool, adapter);
        if (!adapter.standard && standardNames.has(normalized.name)) return;
        if (adapter.standard) standardNames.add(normalized.name);
        if (discoveredTools.has(normalized.id)) {
          const existing = discoveredTools.get(normalized.id).normalized;
          const diagnostic = 'Duplicate tool identity from the same API, origin, frame, and name; execution is disabled because it cannot be routed safely.';
          existing.executable = false;
          existing.diagnostic = diagnostic;
          normalized.id = `${normalized.id}|duplicate-${index}`;
          normalized.executable = false;
          normalized.diagnostic = diagnostic;
        }
        collected.push(normalized);
        discoveredTools.set(normalized.id, { rawTool, adapter, normalized });
      });
    }

    const diagnostics = declarativeDiagnostics();
    const declarativeNames = new Set(diagnostics.map((tool) => tool.name));
    for (const tool of collected) {
      if (tool.origin === (location.origin || '') && tool.framePath === 'top' && declarativeNames.has(tool.name)) {
        tool.type = 'declarative';
        tool.kind = 'form';
        tool.source = 'browser WebMCP API + form[toolname]';
      }
    }
    const unresolvedDiagnostics = diagnostics.filter((diagnostic) => !collected.some((tool) => (
      tool.name === diagnostic.name
      && tool.origin === diagnostic.origin
      && tool.framePath === diagnostic.framePath
    )));

    return {
      success: true,
      tools: collected,
      declarativeDiagnostics: unresolvedDiagnostics,
      apis: apiReports,
      apiAvailable: adapters.length > 0,
      warnings: apiReports.filter((item) => item.error).map((item) => `${item.flavor}: ${item.error}`),
      pageInstanceId,
      url: location.href
    };
  }

  function retryWithJsonString(error) {
    const text = errorMessage(error).toLowerCase();
    const stringContractMismatch = /expected.*string|domstring|not of type.*string|parameter 2.*string|parse.*json|json.*input|input.*json|invalid input arguments/.test(text);
    const chromiumParseFailure = /unknownerror/.test(text) && /(?:failed|unable|could not).*parse.*input arguments/.test(text);
    return stringContractMismatch || chromiumParseFailure;
  }

  async function executeTool(toolId, inputArgs, expectedPageInstanceId) {
    if (!expectedPageInstanceId || expectedPageInstanceId !== pageInstanceId) {
      throw new Error('The page document changed since discovery. Refresh tools and try again.');
    }
    const entry = discoveredTools.get(String(toolId || ''));
    if (!entry) throw new Error('The selected tool is stale or no longer registered. Refresh tools and try again.');
    if (!entry.normalized.executable) throw new Error(entry.normalized.schemaError || 'This entry is diagnostic-only and cannot be executed.');
    const { adapter, rawTool, normalized } = entry;
    if (adapter.executeMode === 'name-json') {
      return adapter.api.executeTool(normalized.name, JSON.stringify(inputArgs ?? {}));
    }
    try { return await adapter.api.executeTool(rawTool, inputArgs ?? {}); }
    catch (error) {
      if (!retryWithJsonString(error)) throw error;
      return adapter.api.executeTool(rawTool, JSON.stringify(inputArgs ?? {}));
    }
  }

  function notifyChanged() {
    sendRuntimeMessage({ type: 'TOOLS_CHANGED', url: location.href });
  }

  function scheduleChanged() {
    clearTimeout(changeNotificationTimer);
    changeNotificationTimer = setTimeout(() => {
      changeNotificationTimer = null;
      notifyChanged();
    }, 100);
  }

  function nodeContainsDeclarativeForm(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      return node.matches?.('form[toolname]') || Boolean(node.querySelector?.('form[toolname]'));
    } catch { return false; }
  }

  function mutationAffectsDeclarativeTools(mutation) {
    if (mutation.type === 'attributes') {
      const target = mutation.target;
      if (target?.matches?.('form')) return true;
      try { return Boolean(target?.closest?.('form[toolname]')); } catch { return false; }
    }
    if (mutation.type !== 'childList') return false;
    try {
      if (mutation.target?.closest?.('form[toolname]')) return true;
    } catch {}
    return [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])].some(nodeContainsDeclarativeForm);
  }

  function installListeners() {
    if (!isTopFrame()) return;
    for (const adapter of getAdapters()) {
      if (listenedApis.has(adapter.api)) continue;
      listenedApis.add(adapter.api);
      const handler = () => scheduleChanged();
      try { adapter.api.addEventListener?.('toolchange', handler); } catch {}
      for (const eventName of ['toolactivated', 'toolcanceled']) {
        try {
          adapter.api.addEventListener?.(eventName, (event) => {
            sendRuntimeMessage({
              type: 'TOOL_EVENT',
              event: eventName,
              toolName: event?.detail?.toolName || event?.toolName || null,
              url: location.href
            });
          });
        } catch {}
      }
      try { adapter.api.registerToolsChangedCallback?.(handler); } catch {}
    }
    if (typeof MutationObserver !== 'undefined' && !domObserver && document.documentElement) {
      domObserver = new MutationObserver((mutations) => {
        if (mutations.some(mutationAffectsDeclarativeTools)) scheduleChanged();
      });
      domObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'toolname', 'tooldescription', 'toolautosubmit', 'name', 'toolparamdescription',
          'type', 'required', 'disabled', 'multiple', 'min', 'max', 'step', 'minlength',
          'maxlength', 'pattern'
        ]
      });
    }
  }

  globalThis.chrome?.runtime?.onMessage?.addListener((message, _sender, reply) => {
    if (message?.action === 'LIST_TOOLS') {
      listTools(message.fromOrigins).then((result) => replySafely(reply, result));
      return true;
    }
    if (message?.action === 'EXECUTE_TOOL') {
      executeTool(message.toolId, message.inputArgs, message.pageInstanceId)
        .then((result) => replySafely(reply, { success: true, result: toSerializable(result) }))
        .catch((error) => replySafely(reply, { success: false, error: errorMessage(error) }));
      return true;
    }
    return false;
  });

  installListeners();
  sendRuntimeMessage({ type: 'CONTENT_READY', url: location.href });
  window.addEventListener?.('DOMContentLoaded', () => { installListeners(); scheduleChanged(); }, { once: true });
  window.addEventListener?.('load', () => { installListeners(); scheduleChanged(); }, { once: true });
  setTimeout(() => { installListeners(); scheduleChanged(); }, 750);
})();
