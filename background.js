/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Background Service Worker
 * Central message router + per-tab tool cache for popup and side panel.
 */

const CONFIG = {
  BADGE_COLOR: '#2563eb',
  BADGE_TEXT_COLOR: '#ffffff'
};

/** @type {Map<number, { tools: any[], url: string, updatedAt: number }>} */
const tabToolState = new Map();

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.debug('[Background] Failed to set side panel behavior:', error?.message || error);
  });
}

function isInspectableUrl(url) {
  if (!url) return false;
  const restrictedSchemes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'edge-extension://',
    'about:',
    'file://',
    'data:',
    'javascript:',
    'blob:'
  ];
  return !restrictedSchemes.some((scheme) => url.startsWith(scheme));
}

function getErrorMessage(error, fallback = 'Unknown error') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message.trim()) return error.message;
  return String(error);
}

function getTabSnapshot(tabId) {
  const state = tabToolState.get(tabId);
  if (!state) {
    return { tools: [], url: '', updatedAt: 0 };
  }
  return state;
}

function setTabSnapshot(tabId, patch) {
  const current = getTabSnapshot(tabId);
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now()
  };
  tabToolState.set(tabId, next);
  return next;
}

async function updateBadge(tabId, toolCount = 0) {
  try {
    const text = toolCount > 0 ? String(toolCount) : '';
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: CONFIG.BADGE_COLOR });
    await chrome.action.setBadgeTextColor({ color: CONFIG.BADGE_TEXT_COLOR });
  } catch (error) {
    console.debug('[Background] Badge update failed:', error.message);
  }
}

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab || null;
}

function isMissingReceiverError(error) {
  const message = String(error?.message || error || '');
  return /could not establish connection|receiving end does not exist/i.test(message);
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js']
    });
    return true;
  } catch (error) {
    console.debug('[Background] Failed to inject content script:', error.message);
    return false;
  }
}

async function sendMessageToTab(tabId, payload, options = {}) {
  const { autoInject = true } = options;

  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!autoInject || !isMissingReceiverError(error)) {
      throw error;
    }

    const injected = await ensureContentScript(tabId);
    if (!injected) {
      throw error;
    }

    return chrome.tabs.sendMessage(tabId, payload);
  }
}

function normalizeTabMessageError(error) {
  if (isMissingReceiverError(error)) {
    return 'Cannot connect to page context yet. Reload the tab once and try Refresh again.';
  }
  return getErrorMessage(error, 'Unknown tab messaging error');
}

async function requestToolList(tabId) {
  try {
    const response = await sendMessageToTab(tabId, { action: 'LIST_TOOLS' }, { autoInject: true });
    if (response?.success && Array.isArray(response.tools)) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const snapshot = setTabSnapshot(tabId, {
        tools: response.tools,
        url: tab?.url || response.url || ''
      });
      await updateBadge(tabId, snapshot.tools.length);
      await chrome.runtime.sendMessage({
        type: 'TOOLS_UPDATE',
        tools: snapshot.tools,
        url: snapshot.url,
        updatedAt: snapshot.updatedAt
      }).catch(() => {});
      return { success: true, ...snapshot };
    }

    if (response?.error) {
      return { error: response.error, tools: [] };
    }

    return { success: true, ...getTabSnapshot(tabId) };
  } catch (error) {
    return { error: normalizeTabMessageError(error), tools: [] };
  }
}

async function refreshActiveTabTools() {
  const activeTab = await getActiveTab();
  if (!activeTab) {
    return { error: 'No active tab', tools: [] };
  }

  if (!isInspectableUrl(activeTab.url)) {
    const snapshot = setTabSnapshot(activeTab.id, { tools: [], url: activeTab.url || '' });
    await updateBadge(activeTab.id, 0);
    return {
      error: 'Current tab is not inspectable (chrome://, extension pages, file://, etc.)',
      ...snapshot
    };
  }

  return requestToolList(activeTab.id);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed/updated');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'refresh-tools') {
    await refreshActiveTabTools();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabToolState.delete(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  if (!isInspectableUrl(tab.url)) {
    await updateBadge(tabId, 0);
    return;
  }

  await requestToolList(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  if (!isInspectableUrl(tab.url)) {
    await updateBadge(tabId, 0);
    setTabSnapshot(tabId, { tools: [], url: tab.url || '' });
    return;
  }

  setTimeout(() => {
    requestToolList(tabId).catch(() => {});
  }, 350);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    try {
      const { type } = message;

      switch (type) {
        case 'TOOLS_LIST': {
          if (!sender.tab?.id) {
            reply({ error: 'Missing sender tab context' });
            return;
          }

          const tabId = sender.tab.id;
          const snapshot = setTabSnapshot(tabId, {
            tools: Array.isArray(message.tools) ? message.tools : [],
            url: message.url || sender.tab.url || ''
          });
          await updateBadge(tabId, snapshot.tools.length);

          await chrome.runtime.sendMessage({
            type: 'TOOLS_UPDATE',
            tools: snapshot.tools,
            url: snapshot.url,
            updatedAt: snapshot.updatedAt
          }).catch(() => {});

          reply({ received: true });
          return;
        }

        case 'STATUS': {
          await chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            message: message.message,
            messageType: message.messageType,
            url: message.url
          }).catch(() => {});
          reply({ received: true });
          return;
        }

        case 'TOOL_EVENT': {
          await chrome.runtime.sendMessage({
            type: 'TOOL_EVENT',
            event: message.event,
            toolName: message.toolName
          }).catch(() => {});
          reply({ received: true });
          return;
        }

        case 'GET_TOOLS': {
          const activeTab = await getActiveTab();
          if (!activeTab) {
            reply({ error: 'No active tab', tools: [] });
            return;
          }

          if (message.forceRefresh) {
            const result = await refreshActiveTabTools();
            reply(result);
            return;
          }

          const cached = getTabSnapshot(activeTab.id);
          if (cached.tools.length > 0) {
            reply({ success: true, ...cached });
            return;
          }

          const result = await refreshActiveTabTools();
          reply(result);
          return;
        }

        case 'REFRESH_TOOLS': {
          const result = await refreshActiveTabTools();
          reply(result);
          return;
        }

        case 'EXECUTE_TOOL': {
          const activeTab = await getActiveTab();
          if (!activeTab) {
            reply({ error: 'No active tab' });
            return;
          }

          if (!isInspectableUrl(activeTab.url)) {
            reply({ error: 'Current tab is not inspectable' });
            return;
          }

          const result = await sendMessageToTab(activeTab.id, {
            action: 'EXECUTE_TOOL',
            name: message.name,
            inputArgs: message.inputArgs
          }, { autoInject: true });

          reply(result);
          return;
        }

        default:
          reply({ error: `Unknown message type: ${type}` });
      }
    } catch (error) {
      console.error('[Background] Message handler error:', error);
      reply({ error: getErrorMessage(error) });
    }
  })();

  return true;
});

console.log('[Background] Service worker initialized');
