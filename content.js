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

function getWebMCPAPI() {
  // Prefer testing API because it includes discovery + execution methods used by inspector.
  try {
    return navigator.modelContextTesting || navigator.modelContext || null;
  } catch {
    return null;
  }
}

function detectApiFlavor(api) {
  try {
    if (!api) return null;
    if (api === navigator.modelContextTesting) return 'testing';
    if (api === navigator.modelContext) return 'stable';
    return 'unknown';
  } catch {
    return null;
  }
}

function getCapabilities(api) {
  if (!api) return [];
  const names = [
    'listTools',
    'executeTool',
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

function normalizeTools(rawTools) {
  if (!Array.isArray(rawTools)) return [];
  return rawTools
    .filter((tool) => tool && typeof tool === 'object')
    .map((tool) => {
      const normalized = {
        name: tool.name || '(unnamed_tool)',
        description: tool.description || '',
        inputSchema: parseToolInputSchema(tool.inputSchema)
      };

      if (typeof tool.type === 'string') normalized.type = tool.type;
      if (typeof tool.kind === 'string') normalized.kind = tool.kind;
      if (typeof tool.source === 'string') normalized.source = tool.source;
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

function listTools() {
  try {
    const api = getWebMCPAPI();
    if (!api) {
      return {
        success: false,
        error: 'WebMCP API is not available on this page',
        tools: [],
        api: null,
        capabilities: []
      };
    }

    if (typeof api.listTools !== 'function') {
      sendStatus('WebMCP detected, but listTools() is unavailable in this API surface.', 'warning');
      return {
        success: true,
        tools: [],
        api: detectApiFlavor(api),
        capabilities: getCapabilities(api),
        warning: 'Current API surface does not expose listTools().'
      };
    }

    const tools = normalizeTools(api.listTools());
    const payload = {
      success: true,
      tools,
      api: detectApiFlavor(api),
      capabilities: getCapabilities(api),
      url: location.href
    };

    sendRuntimeMessage({
      type: 'TOOLS_LIST',
      tools,
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

function setupToolsChangedListener() {
  const api = getWebMCPAPI();
  if (!api || typeof api.registerToolsChangedCallback !== 'function') return;

  if (toolsChangedCallback && typeof api.unregisterToolsChangedCallback === 'function') {
    try {
      api.unregisterToolsChangedCallback(toolsChangedCallback);
    } catch {
      // best effort
    }
  }

  toolsChangedCallback = () => {
    console.debug('[WebMCP Inspector] Tools changed callback received');
    listTools();
  };

  try {
    api.registerToolsChangedCallback(toolsChangedCallback);
  } catch (error) {
    console.debug('[WebMCP Inspector] Failed to register tools changed callback:', error.message);
  }
}

async function executeTool(name, inputArgs) {
  const api = getWebMCPAPI();
  if (!api) {
    throw new Error('WebMCP API not available');
  }

  if (typeof api.executeTool !== 'function') {
    throw new Error('executeTool() is not available on this page API surface');
  }

  const safeName = String(name || '');
  console.debug(`[WebMCP Inspector] Executing tool "${safeName}"`, inputArgs);

  let formElement = null;
  try {
    formElement = document.querySelector(`form[toolname="${cssEscape(safeName)}"]`);
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

  let result;
  try {
    result = await api.executeTool(safeName, inputArgs);
  } catch (error) {
    // Some experimental API variants expect JSON string arguments.
    if (
      typeof inputArgs !== 'string' &&
      /parse input arguments/i.test(String(error?.message || ''))
    ) {
      result = await api.executeTool(safeName, JSON.stringify(inputArgs));
    } else {
      throw error;
    }
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
          const result = listTools();
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
listTools();
setupToolsChangedListener();
})();
