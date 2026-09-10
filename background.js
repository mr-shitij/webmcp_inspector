/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authoritative per-tab discovery and execution router.
 *
 * tabState is an in-memory Map that Chrome can wipe when the MV3 service
 * worker suspends (~30 s of inactivity).  To survive that:
 *  1. Every successful discovery writes to chrome.storage.session.
 *  2. getSnapshot() transparently restores from session storage when the
 *     in-memory map has no entry for the requested tab.
 *  3. EXECUTE_TOOL auto-rediscovers (just-in-time) instead of hard-failing
 *     when the snapshot is stale.
 *  4. The sidebar sends periodic KEEPALIVE pings to prevent suspension
 *     while it is open and interacting with the user.
 */

const BADGE = { background: '#2563eb', foreground: '#ffffff' };
const SESSION_KEY_PREFIX = 'tab_';
const tabState = new Map();
const requestGeneration = new Map();

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

function messageOf(error, fallback = 'Unknown error') {
  if (!error) return fallback;
  return typeof error === 'string' ? error : error.message || String(error);
}

function isInspectableUrl(url) {
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback);
  } catch { return false; }
}

function emptySnapshot(tabId, url = '') {
  return { tabId, tools: [], declarativeDiagnostics: [], apis: [], apiAvailable: false, warnings: [], pageInstanceId: null, url, updatedAt: 0 };
}

/** Read from in-memory cache; on miss, try session storage synchronously-cached value. */
function getSnapshot(tabId) {
  return tabState.get(tabId) || emptySnapshot(tabId);
}

/** Restore a single tab snapshot from session storage into the in-memory map. */
async function restoreSnapshot(tabId) {
  if (tabState.has(tabId)) return getSnapshot(tabId);
  try {
    const key = `${SESSION_KEY_PREFIX}${tabId}`;
    const stored = await chrome.storage?.session?.get(key);
    if (stored?.[key] && typeof stored[key] === 'object') {
      const restored = { ...emptySnapshot(tabId), ...stored[key], tabId };
      tabState.set(tabId, restored);
      return restored;
    }
  } catch (error) {
    console.debug('[Background] Session restore failed for tab', tabId, messageOf(error));
  }
  return emptySnapshot(tabId);
}

function setSnapshot(tabId, patch) {
  const snapshot = { ...getSnapshot(tabId), ...patch, tabId, updatedAt: Date.now() };
  tabState.set(tabId, snapshot);
  // Persist to session storage (fire-and-forget, never blocks the caller).
  const key = `${SESSION_KEY_PREFIX}${tabId}`;
  chrome.storage?.session?.set?.({ [key]: snapshot })?.catch?.(() => {});
  return snapshot;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (tab) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return fallback || null;
}

async function isActiveTab(tabId) {
  return (await getActiveTab())?.id === tabId;
}

async function updateBadge(tabId, count) {
  try {
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE.background });
    await chrome.action.setBadgeTextColor?.({ color: BADGE.foreground });
  } catch (error) {
    console.debug('[Background] Badge update failed:', messageOf(error));
  }
}

async function broadcastIfActive(type, tabId, payload) {
  if (!(await isActiveTab(tabId))) return;
  await chrome.runtime.sendMessage({ type, tabId, ...payload }).catch(() => {});
}

function isMissingReceiver(error) {
  return /could not establish connection|receiving end does not exist/i.test(messageOf(error));
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
    return true;
  } catch (error) {
    console.debug('[Background] Content script injection failed:', messageOf(error));
    return false;
  }
}

async function sendToTopFrame(tabId, message, autoInject = true) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    if (!autoInject || !isMissingReceiver(error) || !(await ensureContentScript(tabId))) throw error;
    return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  }
}

function originFor(url) {
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null;
    return parsed.origin;
  } catch { return null; }
}

async function getFrameOrigins(tabId, topUrl) {
  if (!chrome.webNavigation?.getAllFrames) return [];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const topOrigin = originFor(topUrl);
    return [...new Set((frames || []).map((frame) => originFor(frame.url)).filter((origin) => origin && origin !== topOrigin))];
  } catch (error) {
    console.debug('[Background] Could not enumerate frame origins:', messageOf(error));
    return [];
  }
}

async function requestToolList(tabId) {
  const generation = (requestGeneration.get(tabId) || 0) + 1;
  requestGeneration.set(tabId, generation);
  try {
    const before = await chrome.tabs.get(tabId);
    if (!before || !isInspectableUrl(before.url)) {
      const snapshot = setSnapshot(tabId, emptySnapshot(tabId, before?.url || ''));
      await updateBadge(tabId, 0);
      await broadcastIfActive('TOOLS_UPDATE', tabId, snapshot);
      return { error: 'Current tab is not inspectable', ...snapshot };
    }
    const fromOrigins = await getFrameOrigins(tabId, before.url);
    const response = await sendToTopFrame(tabId, { action: 'LIST_TOOLS', fromOrigins });
    const after = await chrome.tabs.get(tabId).catch(() => null);
    if (requestGeneration.get(tabId) !== generation || !after) {
      return { error: 'Page changed while tools were being discovered. Refresh again.', stale: true, ...getSnapshot(tabId) };
    }
    if (!response?.success) throw new Error(response?.error || 'Page returned an invalid discovery response');

    const snapshot = setSnapshot(tabId, {
      tools: Array.isArray(response.tools) ? response.tools : [],
      declarativeDiagnostics: Array.isArray(response.declarativeDiagnostics) ? response.declarativeDiagnostics : [],
      apis: Array.isArray(response.apis) ? response.apis : [],
      apiAvailable: Boolean(response.apiAvailable),
      warnings: Array.isArray(response.warnings) ? response.warnings : [],
      pageInstanceId: typeof response.pageInstanceId === 'string' ? response.pageInstanceId : null,
      url: after.url
    });
    await updateBadge(tabId, snapshot.tools.length);
    await broadcastIfActive('TOOLS_UPDATE', tabId, snapshot);
    return { success: true, ...snapshot };
  } catch (error) {
    const normalized = isMissingReceiver(error)
      ? 'Cannot connect to this page. Reload it once, then refresh the inspector.'
      : messageOf(error);
    return { error: normalized, ...getSnapshot(tabId) };
  }
}

async function refreshActiveTab() {
  const tab = await getActiveTab();
  if (!tab) return { error: 'No active tab', tools: [] };
  if (!isInspectableUrl(tab.url)) {
    requestGeneration.set(tab.id, (requestGeneration.get(tab.id) || 0) + 1);
    const snapshot = setSnapshot(tab.id, emptySnapshot(tab.id, tab.url || ''));
    await updateBadge(tab.id, 0);
    await broadcastIfActive('TOOLS_UPDATE', tab.id, snapshot);
    return { error: 'Current tab is not inspectable', ...snapshot };
  }
  return requestToolList(tab.id);
}

/**
 * Ensure the snapshot for `tabId` has a valid pageInstanceId.
 * If the in-memory map is empty (service worker restarted), first try
 * session storage, then fall back to a live rediscovery.
 */
async function ensureSnapshot(tabId) {
  // 1. In-memory hit
  let snapshot = tabState.get(tabId);
  if (snapshot?.pageInstanceId) return snapshot;

  // 2. Session storage recovery (fast, no network)
  snapshot = await restoreSnapshot(tabId);
  if (snapshot?.pageInstanceId) return snapshot;

  // 3. Live rediscovery (talks to content script)
  const result = await requestToolList(tabId);
  if (result?.success) return getSnapshot(tabId);
  return getSnapshot(tabId);
}

chrome.runtime.onInstalled.addListener(() => console.log('[Background] Extension installed/updated'));
chrome.commands.onCommand.addListener((command) => {
  if (command === 'refresh-tools') refreshActiveTab().catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  requestGeneration.delete(tabId);
  chrome.storage?.session?.remove?.(`${SESSION_KEY_PREFIX}${tabId}`)?.catch?.(() => {});
});
chrome.tabs.onActivated.addListener(({ tabId }) => requestToolList(tabId).catch(() => {}));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    requestGeneration.set(tabId, (requestGeneration.get(tabId) || 0) + 1);
    const snapshot = setSnapshot(tabId, emptySnapshot(tabId, tab.url || changeInfo.url || ''));
    updateBadge(tabId, 0).catch(() => {});
    broadcastIfActive('TOOLS_UPDATE', tabId, snapshot).catch(() => {});
  }
  if (changeInfo.status === 'complete' && isInspectableUrl(tab.url)) {
    setTimeout(() => requestToolList(tabId).catch(() => {}), 250);
  }
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'CONTENT_READY':
        case 'TOOLS_CHANGED': {
          if (!sender.tab?.id || sender.frameId !== 0) return reply({ received: true, ignored: 'non-top-frame' });
          requestToolList(sender.tab.id).catch(() => {});
          return reply({ received: true });
        }
        case 'STATUS': {
          if (!sender.tab?.id) return reply({ error: 'Missing sender tab context' });
          await broadcastIfActive('STATUS_UPDATE', sender.tab.id, {
            message: message.message,
            messageType: message.messageType,
            url: message.url || sender.tab.url || ''
          });
          return reply({ received: true });
        }
        case 'TOOL_EVENT': {
          if (!sender.tab?.id) return reply({ error: 'Missing sender tab context' });
          await broadcastIfActive('TOOL_EVENT', sender.tab.id, { event: message.event, toolName: message.toolName });
          return reply({ received: true });
        }
        case 'GET_TOOLS': {
          const tab = await getActiveTab();
          if (!tab) return reply({ error: 'No active tab', tools: [] });
          if (message.forceRefresh) return reply(await refreshActiveTab());
          const cached = await restoreSnapshot(tab.id);
          if (cached.updatedAt > 0 && cached.url === tab.url && cached.pageInstanceId) return reply({ success: true, ...cached });
          return reply(await refreshActiveTab());
        }
        case 'REFRESH_TOOLS':
          return reply(await refreshActiveTab());
        case 'KEEPALIVE':
          return reply({ alive: true });
        case 'EXECUTE_TOOL': {
          const active = await getActiveTab();
          if (!Number.isInteger(message.tabId)) return reply({ error: 'Missing inspected tab identity. Refresh the inspector.' });
          if (!active || active.id !== message.tabId) return reply({ error: 'The inspected tab is no longer active. Refresh before executing.' });
          if (!isInspectableUrl(active.url)) return reply({ error: 'Current tab is not inspectable' });

          // Auto-recover snapshot if the service worker restarted and lost tabState.
          const snapshot = await ensureSnapshot(active.id);
          if (!snapshot.pageInstanceId) {
            return reply({ error: 'Could not re-establish page identity. Reload the inspected page and try again.' });
          }
          if (!snapshot.tools.some((tool) => tool.id === message.toolId)) {
            // Tool id may have changed after rediscovery; broadcast the fresh state
            // so the sidebar can re-select and retry.
            await broadcastIfActive('TOOLS_UPDATE', active.id, snapshot);
            return reply({ error: 'Tool identity changed after rediscovery. The tool list has been refreshed — please retry.' });
          }
          const result = await sendToTopFrame(active.id, {
            action: 'EXECUTE_TOOL',
            toolId: message.toolId,
            inputArgs: message.inputArgs,
            pageInstanceId: snapshot.pageInstanceId
          });
          return reply(result);
        }
        default:
          return reply({ error: `Unknown message type: ${message?.type}` });
      }
    } catch (error) {
      console.error('[Background] Message handler error:', error);
      reply({ error: messageOf(error) });
    }
  })();
  return true;
});

console.log('[Background] Service worker initialized');
