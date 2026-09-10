(() => {
/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content Script
 * Detects available WebMCP APIs, lists tools, and executes tools on request.
 */

if (window.__webmcpInspectorInjected) {
  console.debug('[WebMCP Inspector] Content script already active in this frame');
  return;
}
window.__webmcpInspectorInjected = true;
console.debug('[WebMCP Inspector] Content script injected');

let toolsChangedCallback = null;

function isTopFrame() {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function toPlainSerializable(value, depth = 0, seen = new WeakSet()) {
  if (value === null) return null;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }
  if (valueType === 'bigint') {
    return String(value);
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') {
    return undefined;
  }

  if (depth > 8) {
    return '[MaxDepth]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const arr = [];
    for (const item of value) {
      const normalized = toPlainSerializable(item, depth + 1, seen);
      if (normalized !== undefined) {
        arr.push(normalized);
      }
    }
    return arr;
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      const normalized = toPlainSerializable(nested, depth + 1, seen);
      if (normalized !== undefined) {
        out[key] = normalized;
      }
    }

    seen.delete(value);
    return out;
  }

  return undefined;
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value));
  }
  return String(value).replace(/["\\]/g, '\\$&');
}

const lastDiscoveredToolsMap = new Map();

function getWebMCPAPI() {
  try {
    if (typeof document !== 'undefined' && document.modelContext) {
      return document.modelContext;
    }
    if (typeof window !== 'undefined' && window.modelContext) {
      return window.modelContext;
    }
    if (typeof navigator !== 'undefined') {
      return navigator.modelContextTesting || navigator.modelContext || null;
    }
    return null;
  } catch {
    return null;
  }
}

function detectApiFlavor(api) {
  try {
    if (!api) return null;
    if (typeof document !== 'undefined' && api === document.modelContext) return 'document.modelContext';
    if (typeof window !== 'undefined' && api === window.modelContext) return 'window.modelContext';
    if (typeof navigator !== 'undefined') {
      if (api === navigator.modelContextTesting) return 'testing';
      if (api === navigator.modelContext) return 'navigator.modelContext';
    }
    return 'custom';
  } catch {
    return null;
  }
}

function getCapabilities(api) {
  if (!api) return [];
  const names = [
    'getTools',
    'listTools',
    'executeTool',
    'addEventListener',
    'registerToolsChangedCallback',
    'getCrossDocumentScriptToolResult',
    'registerTool',
    'unregisterTool',
    'provideContext',
    'clearContext'
  ];
  return names.filter((name) => {
    try {
      return typeof api[name] === 'function';
    } catch {
      return false;
    }
  });
}

function sendStatus(message, type = 'info') {
  sendRuntimeMessage({
    type: 'STATUS',
    message,
    messageType: type,
    url: location.href
  });
}

function isExtensionContextInvalidatedError(error) {
  return /extension context invalidated/i.test(String(error?.message || error));
}

function isDomExceptionError(error) {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return true;
  }
  return /\bDOMException\b/i.test(String(error?.message || error));
}

function getRuntime() {
  try {
    return globalThis.chrome?.runtime || null;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.debug('[WebMCP Inspector] Unable to access chrome.runtime:', error);
    }
    return null;
  }
}

function sendRuntimeMessage(payload) {
  const runtime = getRuntime();
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return;
  }

  try {
    const maybePromise = runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.debug('[WebMCP Inspector] Failed to send runtime message:', error);
    }
  }
}

function safeReply(reply, payload) {
  if (typeof reply !== 'function') return;

  try {
    reply(payload);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.debug('[WebMCP Inspector] Failed to reply to runtime message:', error);
    }
  }
}

function errorToString(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;

  const name = typeof error.name === 'string' ? error.name : '';
  const message = typeof error.message === 'string' ? error.message : '';
  if (name && message) return `${name}: ${message}`;
  if (message) return message;

  const plain = toPlainSerializable(error);
  if (plain !== undefined) {
    try {
      return JSON.stringify(plain);
    } catch {
      // fall through
    }
  }

  return String(error);
}

function shouldRetryExecuteWithStringArgs(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const errorName = String(error?.name || '').toLowerCase();
  const hasJsonSignal =
    message.includes('json') ||
    message.includes('parse') ||
    message.includes('input');
  return (
    message.includes('parse input arguments') ||
    message.includes('parse input string as json') ||
    message.includes('failed to parse input string as json') ||
    message.includes('invalid input arguments') ||
    message.includes('expected string') ||
    (errorName === 'unknownerror' && hasJsonSignal)
  );
}

function hasDeclarativeFormWithToolName(toolName) {
  if (!toolName || toolName === '(unnamed_tool)') return false;
  try {
    return Boolean(
      document.querySelector(`form[toolname="${cssEscape(toolName)}"], form[tool-name="${cssEscape(toolName)}"]`)
    );
  } catch {
    return false;
  }
}

function hasDeclarativeMetadata(tool) {
  const type = String(tool?.type || '').toLowerCase();
  const kind = String(tool?.kind || '').toLowerCase();
  const source = String(tool?.source || '').toLowerCase();

  if (type.includes('declarative') || kind === 'form' || source.includes('form')) {
    return true;
  }

  const annotations = tool?.annotations;
  if (annotations && typeof annotations === 'object') {
    const annotationValues = Object.values(annotations)
      .map((value) => String(value).toLowerCase());
    if (annotationValues.some((value) => value.includes('declarative') || value.includes('form'))) {
      return true;
    }
  }

  return false;
}

function extractDeclarativeFormTool(form) {
  if (!form) return null;
  const name = form.getAttribute('toolname') || form.getAttribute('tool-name') || form.name || form.id;
  if (!name || name === '(unnamed_tool)') return null;

  const description =
    form.getAttribute('tooldescription') ||
    form.getAttribute('tool-description') ||
    form.getAttribute('title') ||
    form.getAttribute('aria-label') ||
    '';

  const properties = {};
  const required = [];

  const elements = form.elements || [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const paramName =
      el.getAttribute('toolparamname') ||
      el.getAttribute('tool-param-name') ||
      el.name ||
      el.id;
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    const typeAttr = el.type ? el.type.toLowerCase() : '';

    if (!paramName || tagName === 'button' || typeAttr === 'submit' || typeAttr === 'reset' || typeAttr === 'button') {
      continue;
    }

    const prop = {};
    if (typeAttr === 'number' || typeAttr === 'range') {
      prop.type = 'number';
    } else if (typeAttr === 'checkbox') {
      prop.type = 'boolean';
    } else {
      prop.type = 'string';
    }

    const paramDesc =
      el.getAttribute('toolparamdescription') ||
      el.getAttribute('tool-param-description') ||
      el.placeholder ||
      el.title ||
      '';
    if (paramDesc) {
      prop.description = paramDesc;
    }

    properties[paramName] = prop;
    if (el.required && !required.includes(paramName)) {
      required.push(paramName);
    }
  }

  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required
    },
    type: 'declarative',
    kind: 'form',
    source: 'form'
  };
}

function scanDeclarativeFormsInDom() {
  const forms = [];
  try {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
      return forms;
    }
    const elements = document.querySelectorAll('form[toolname], form[tool-name]');
    for (const form of elements) {
      const tool = extractDeclarativeFormTool(form);
      if (tool) {
        forms.push(tool);
      }
    }
  } catch (err) {
    console.debug('[WebMCP Inspector] Failed scanning DOM for declarative forms:', err);
  }
  return forms;
}

function normalizeTools(rawTools) {
  if (!Array.isArray(rawTools)) return [];
  return rawTools
    .filter((tool) => tool && typeof tool === 'object')
    .map((tool) => {
      const toolName = tool.name || '(unnamed_tool)';
      const looksDeclarative = hasDeclarativeMetadata(tool) || hasDeclarativeFormWithToolName(toolName);
      const normalized = {
        name: toolName,
        description: tool.description || '',
        inputSchema: parseToolInputSchema(tool.inputSchema)
      };

      if (looksDeclarative) {
        normalized.type = 'declarative';
        normalized.kind = 'form';
        normalized.source = 'form';
      } else {
        if (typeof tool.type === 'string') normalized.type = tool.type;
        if (typeof tool.kind === 'string') normalized.kind = tool.kind;
        if (typeof tool.source === 'string') normalized.source = tool.source;
      }

      if (tool.annotations && typeof tool.annotations === 'object') {
        normalized.annotations = toPlainSerializable(tool.annotations) || {};
      }

      return normalized;
    });
}

function toPlainSchemaObject(value) {
  const normalized = toPlainSerializable(value);
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    return normalized;
  }
  return { type: 'object', properties: {} };
}

function parseToolInputSchema(schema) {
  if (!schema) return { type: 'object', properties: {} };
  if (typeof schema === 'string') {
    try {
      const parsed = JSON.parse(schema);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return toPlainSchemaObject(parsed);
      }
    } catch {
      // fall through
    }
    return { type: 'object', properties: {} };
  }
  if (typeof schema === 'object' && !Array.isArray(schema)) {
    return toPlainSchemaObject(schema);
  }
  return { type: 'object', properties: {} };
}

async function listTools() {
  try {
    if (!isTopFrame()) {
      console.debug('[WebMCP Inspector] Skipping listTools in non-top frame', location.href);
      return {
        success: true,
        ignored: 'non-top-frame',
        tools: [],
        api: null,
        capabilities: [],
        url: location.href
      };
    }

    const api = getWebMCPAPI();
    let rawTools = [];
    let warning = null;

    if (api) {
      if (typeof api.getTools === 'function') {
        try {
          const result = await api.getTools();
          rawTools = Array.isArray(result) ? result : [];
        } catch (error) {
          console.debug('[WebMCP Inspector] api.getTools() error:', error);
          warning = `getTools() error: ${errorToString(error)}`;
        }
      } else if (typeof api.listTools === 'function') {
        try {
          const result = api.listTools();
          rawTools = Array.isArray(result) ? result : [];
        } catch (error) {
          console.debug('[WebMCP Inspector] api.listTools() error:', error);
          warning = `listTools() error: ${errorToString(error)}`;
        }
      } else {
        warning = 'Current API surface does not expose getTools() or listTools().';
        sendStatus('WebMCP detected, but tool discovery method is unavailable.', 'warning');
      }
    }

    const normalizedTools = normalizeTools(rawTools);

    // Cache raw tools for executeTool reference lookup
    lastDiscoveredToolsMap.clear();
    for (const raw of rawTools) {
      if (raw && raw.name) {
        lastDiscoveredToolsMap.set(raw.name, {
          rawTool: raw,
          normalized: normalizedTools.find((t) => t.name === raw.name)
        });
      }
    }

    // Complement with declarative forms found directly in the DOM
    const declarativeForms = scanDeclarativeFormsInDom();
    for (const dTool of declarativeForms) {
      if (!normalizedTools.some((t) => t.name === dTool.name)) {
        normalizedTools.push(dTool);
      }
    }

    const payload = {
      success: true,
      tools: normalizedTools,
      api: detectApiFlavor(api),
      capabilities: getCapabilities(api),
      url: location.href
    };
    if (warning) {
      payload.warning = warning;
    }

    sendRuntimeMessage({
      type: 'TOOLS_LIST',
      tools: normalizedTools,
      url: location.href
    });

    return payload;
  } catch (error) {
    const payload = {
      success: false,
      error: `Error listing tools: ${errorToString(error)}`,
      tools: [],
      api: detectApiFlavor(getWebMCPAPI()),
      capabilities: getCapabilities(getWebMCPAPI())
    };
    sendStatus(payload.error, 'error');
    return payload;
  }
}

let toolChangeListenerAttached = false;
let domMutationObserver = null;

function setupToolsChangedListener() {
  if (!isTopFrame()) return;

  const api = getWebMCPAPI();
  const onToolsChanged = () => {
    console.debug('[WebMCP Inspector] Tools changed event received');
    listTools().catch(() => {});
  };

  if (api) {
    // Modern W3C EventTarget listener
    if (typeof api.addEventListener === 'function' && !toolChangeListenerAttached) {
      try {
        api.addEventListener('toolchange', onToolsChanged);
        api.addEventListener('toolschange', onToolsChanged);
        toolChangeListenerAttached = true;
      } catch (err) {
        console.debug('[WebMCP Inspector] Failed to attach toolchange event listener:', err);
      }
    }

    // Legacy registerToolsChangedCallback
    if (typeof api.registerToolsChangedCallback === 'function') {
      if (toolsChangedCallback && typeof api.unregisterToolsChangedCallback === 'function') {
        try {
          api.unregisterToolsChangedCallback(toolsChangedCallback);
        } catch {
          // best effort
        }
      }

      toolsChangedCallback = onToolsChanged;

      try {
        api.registerToolsChangedCallback(toolsChangedCallback);
      } catch (error) {
        console.debug('[WebMCP Inspector] Failed to register tools changed callback:', error.message);
      }
    }
  }

  // Observe DOM for declarative form mutations
  if (typeof MutationObserver !== 'undefined' && !domMutationObserver && typeof document !== 'undefined' && document.body) {
    try {
      domMutationObserver = new MutationObserver((mutations) => {
        let hasFormMutation = false;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.matches?.('form[toolname], form[tool-name]') || node.querySelector?.('form[toolname], form[tool-name]')) {
                hasFormMutation = true;
                break;
              }
            }
          }
          if (hasFormMutation) break;
          for (const node of m.removedNodes) {
            if (node.nodeType === 1) {
              if (node.matches?.('form[toolname], form[tool-name]') || node.querySelector?.('form[toolname], form[tool-name]')) {
                hasFormMutation = true;
                break;
              }
            }
          }
          if (hasFormMutation) break;
        }
        if (hasFormMutation) {
          listTools().catch(() => {});
        }
      });
      domMutationObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      console.debug('[WebMCP Inspector] Failed to set up form MutationObserver:', e);
    }
  }
}

async function executeDeclarativeForm(formElement, inputArgs, loadPromise) {
  console.debug('[WebMCP Inspector] Executing declarative DOM form directly', formElement);

  if (inputArgs && typeof inputArgs === 'object') {
    for (const [key, val] of Object.entries(inputArgs)) {
      const el = formElement.elements?.[key];
      if (el) {
        if (el.type === 'checkbox') {
          el.checked = Boolean(val);
        } else {
          el.value = String(val ?? '');
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  if (typeof formElement.requestSubmit === 'function') {
    formElement.requestSubmit();
  } else if (typeof formElement.submit === 'function') {
    formElement.submit();
  }

  if (loadPromise) {
    try {
      await Promise.race([loadPromise, new Promise((resolve) => setTimeout(resolve, 2000))]);
    } catch {
      // best effort
    }
  }

  return {
    success: true,
    submitted: true,
    toolName: formElement.getAttribute('toolname') || formElement.getAttribute('tool-name') || formElement.name
  };
}

async function executeTool(name, inputArgs) {
  const safeName = String(name || '');
  console.debug(`[WebMCP Inspector] Executing tool "${safeName}"`, inputArgs);

  const api = getWebMCPAPI();

  let formElement = null;
  try {
    formElement = document.querySelector(
      `form[toolname="${cssEscape(safeName)}"], form[tool-name="${cssEscape(safeName)}"]`
    );
  } catch {
    formElement = null;
  }
  const formTarget = formElement?.target;

  let loadPromise = null;
  if (formTarget) {
    let targetFrame = null;
    try {
      targetFrame = document.querySelector(`[name="${cssEscape(formTarget)}"]`);
    } catch {
      targetFrame = null;
    }
    if (targetFrame) {
      loadPromise = new Promise((resolve) => {
        const handler = () => {
          targetFrame.removeEventListener('load', handler);
          resolve();
        };
        targetFrame.addEventListener('load', handler, { once: true });
      });
    }
  }

  // If no WebMCP API available, fall back to declarative DOM form execution if present
  if (!api || typeof api.executeTool !== 'function') {
    if (formElement) {
      return executeDeclarativeForm(formElement, inputArgs, loadPromise);
    }
    throw new Error('executeTool() is not available on this page API surface');
  }

  const cachedEntry = lastDiscoveredToolsMap.get(safeName);
  const rawTool = cachedEntry?.rawTool;

  let result;
  let lastError = null;

  // Attempt 1: If rawTool is an object, pass it (W3C Spec: executeTool(RegisteredTool, inputObject))
  if (rawTool && typeof rawTool === 'object') {
    try {
      result = await api.executeTool(rawTool, inputArgs);
      lastError = null;
    } catch (err) {
      lastError = err;
    }
  }

  // Attempt 2: Pass tool name string with inputArgs object
  if (result === undefined && (!rawTool || lastError)) {
    try {
      result = await api.executeTool(safeName, inputArgs);
      lastError = null;
    } catch (err) {
      lastError = err;
    }
  }

  // Attempt 3: Retry with JSON string arguments if argument parse error indicated
  if (result === undefined && lastError && typeof inputArgs !== 'string') {
    if (shouldRetryExecuteWithStringArgs(lastError)) {
      const stringArgs = JSON.stringify(inputArgs);
      try {
        if (rawTool && typeof rawTool === 'object') {
          result = await api.executeTool(rawTool, stringArgs);
          lastError = null;
        } else {
          result = await api.executeTool(safeName, stringArgs);
          lastError = null;
        }
      } catch (stringModeError) {
        lastError = stringModeError;

        // Attempt 4: Invocation envelope
        try {
          result = await api.executeTool({
            name: safeName,
            inputArgs: stringArgs
          });
          lastError = null;
        } catch {
          // fall through
        }
      }
    }
  }

  // If API execution failed, but formElement exists in DOM, fallback to declarative form execution
  if (result === undefined && lastError) {
    if (formElement) {
      console.debug('[WebMCP Inspector] api.executeTool failed; falling back to DOM form submission', lastError);
      return executeDeclarativeForm(formElement, inputArgs, loadPromise);
    }
    throw lastError;
  }

  if (result === null) {
    if (loadPromise) {
      try {
        await Promise.race([
          loadPromise,
          new Promise((resolve) => setTimeout(resolve, 2000))
        ]);
      } catch {
        // best effort
      }
    }

    if (typeof api.getCrossDocumentScriptToolResult === 'function') {
      try {
        return await api.getCrossDocumentScriptToolResult();
      } catch (error) {
        // Some implementations may not expose cross-document result in all contexts.
        if (!isDomExceptionError(error)) {
          throw error;
        }
      }
    }
  }

  return result;
}

async function getCrossDocumentScriptToolResult() {
  const api = getWebMCPAPI();
  if (!api || typeof api.getCrossDocumentScriptToolResult !== 'function') {
    throw new Error('getCrossDocumentScriptToolResult() is not available');
  }
  return api.getCrossDocumentScriptToolResult();
}

function handleRuntimeMessage(request, sender, reply) {
  (async () => {
    try {
      const { action, name, inputArgs } = request;

      switch (action) {
        case 'LIST_TOOLS': {
          const result = await listTools();
          setupToolsChangedListener();
          safeReply(reply, toPlainSerializable(result));
          return;
        }

        case 'EXECUTE_TOOL': {
          const result = await executeTool(name, inputArgs);
          safeReply(reply, { success: true, result: toPlainSerializable(result) });
          return;
        }

        case 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT': {
          const result = await getCrossDocumentScriptToolResult();
          safeReply(reply, { success: true, result: toPlainSerializable(result) });
          return;
        }

        case 'CHECK_AVAILABILITY': {
          const api = getWebMCPAPI();
          safeReply(reply, {
            available: !!api,
            api: detectApiFlavor(api),
            capabilities: getCapabilities(api)
          });
          return;
        }

        default:
          safeReply(reply, { error: `Unknown action: ${action}` });
      }
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        // Noisy during extension reloads; ignore.
      } else if (isDomExceptionError(error)) {
        console.debug('[WebMCP Inspector] Message handler DOMException:', error);
      } else {
        console.error('[WebMCP Inspector] Message handler error:', error);
      }
      safeReply(reply, { success: false, error: errorToString(error) });
    }
  })();

  return true;
}

function setupRuntimeListener() {
  const runtime = getRuntime();
  const onMessage = runtime?.onMessage;
  if (!onMessage || typeof onMessage.addListener !== 'function') {
    console.debug('[WebMCP Inspector] chrome.runtime.onMessage unavailable in this context');
    return;
  }

  try {
    onMessage.addListener(handleRuntimeMessage);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.debug('[WebMCP Inspector] Failed to register runtime message listener:', error);
    }
  }
}

window.addEventListener('toolactivated', (event) => {
  sendRuntimeMessage({
    type: 'TOOL_EVENT',
    event: 'activated',
    toolName: event.toolName
  });
});

window.addEventListener('toolcancel', (event) => {
  sendRuntimeMessage({
    type: 'TOOL_EVENT',
    event: 'cancelled',
    toolName: event.toolName
  });
});

// Initial warm-up
setupRuntimeListener();
listTools().catch(() => {});
setupToolsChangedListener();
})();
