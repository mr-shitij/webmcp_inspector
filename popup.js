/**
 * WebMCP Inspector - Popup Script
 * Quick status + top tools, with fast refresh and handoff to side panel.
 */

const elements = {
  apiStatus: document.getElementById('apiStatus'),
  apiStatusText: document.getElementById('apiStatusText'),
  toolCount: document.getElementById('toolCount'),
  toolsContainer: document.getElementById('toolsContainer'),
  popupVersion: document.getElementById('popupVersion'),
  refreshBtn: document.getElementById('refreshBtn'),
  openSidePanelBtn: document.getElementById('openSidePanelBtn')
};

let currentTools = [];

function updateStatus(available, text) {
  elements.apiStatus.classList.toggle('active', available);
  elements.apiStatusText.textContent = text;
}

function updateToolCount(count) {
  elements.toolCount.textContent = `${count} tool${count !== 1 ? 's' : ''}`;
}

function populateVersionLabel() {
  if (!elements.popupVersion) return;
  const manifest = chrome.runtime?.getManifest?.();
  const version = manifest?.version ? ` v${manifest.version}` : '';
  elements.popupVersion.textContent = `WebMCP Inspector${version}`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function showEmptyState(message) {
  elements.toolsContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <div class="empty-state-title">${escapeHtml(message || 'No tools found')}</div>
      <div class="empty-state-desc">
        ${
          message
            ? ''
            : 'Navigate to a page with WebMCP tools, or enable the WebMCP flag in chrome://flags'
        }
      </div>
    </div>
  `;
}

function renderTools(tools) {
  elements.toolsContainer.innerHTML = '';

  if (!Array.isArray(tools) || tools.length === 0) {
    showEmptyState();
    return;
  }

  const toolList = document.createElement('div');
  toolList.className = 'tool-list';

  tools.slice(0, 5).forEach((tool) => {
    const toolItem = document.createElement('div');
    toolItem.className = 'tool-item';

    const isDeclarative =
      tool?.type === 'declarative' ||
      tool?.kind === 'form' ||
      tool?.source === 'form' ||
      (typeof tool?.source === 'string' && tool.source.toLowerCase().includes('form'));
    const typeLabel = isDeclarative ? 'HTML Form' : 'JavaScript';

    toolItem.innerHTML = `
      <div class="tool-info">
        <div class="tool-name">${escapeHtml(tool.name)}</div>
        <div class="tool-type">${typeLabel}</div>
      </div>
      <button class="tool-action" data-tool="${escapeHtml(tool.name)}">Test</button>
    `;

    toolItem.querySelector('.tool-action')?.addEventListener('click', () => {
      openSidePanel(tool.name);
    });

    toolList.appendChild(toolItem);
  });

  if (tools.length > 5) {
    const more = document.createElement('div');
    more.style.cssText = 'text-align:center;color:#6b7280;font-size:12px;padding:8px;';
    more.textContent = `+${tools.length - 5} more tools in full inspector`;
    toolList.appendChild(more);
  }

  elements.toolsContainer.appendChild(toolList);
}

async function getToolState(forceRefresh = false) {
  const type = forceRefresh ? 'REFRESH_TOOLS' : 'GET_TOOLS';
  return chrome.runtime.sendMessage({ type, forceRefresh });
}

async function checkWebMCPStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TOOLS' });
    if (response?.error) {
      updateStatus(false, response.error);
      return;
    }

    const tools = Array.isArray(response?.tools) ? response.tools : [];
    if (tools.length > 0) {
      updateStatus(true, 'WebMCP tools available');
      return;
    }

    updateStatus(false, 'WebMCP not detected on this tab');
  } catch (error) {
    console.error('[Popup] Status check failed:', error);
    updateStatus(false, 'Error checking status');
  }
}

async function loadTools(forceRefresh = false) {
  try {
    const response = await getToolState(forceRefresh);

    if (response?.error) {
      showEmptyState(response.error);
      currentTools = [];
      updateToolCount(0);
      return;
    }

    const tools = Array.isArray(response?.tools) ? response.tools : [];
    currentTools = tools;
    renderTools(tools);
    updateToolCount(tools.length);
    updateStatus(tools.length > 0, tools.length > 0 ? 'WebMCP tools available' : 'No tools found');
  } catch (error) {
    console.error('[Popup] Failed loading tools:', error);
    showEmptyState('Error loading tools');
    updateToolCount(0);
  }
}

async function openSidePanel(toolName = '') {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: currentWindow.id });

    if (toolName) {
      await chrome.storage.local.set({ selectedTool: toolName });
    }

    window.close();
  } catch (error) {
    console.error('[Popup] Failed to open side panel:', error);
  }
}

function setupEventListeners() {
  elements.refreshBtn.addEventListener('click', async () => {
    elements.refreshBtn.disabled = true;
    elements.refreshBtn.textContent = '🔄 Loading...';
    await loadTools(true);
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.textContent = '🔄 Refresh';
  });

  elements.openSidePanelBtn.addEventListener('click', () => {
    openSidePanel();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOOLS_UPDATE') {
      const tools = Array.isArray(message.tools) ? message.tools : [];
      currentTools = tools;
      renderTools(tools);
      updateToolCount(tools.length);
      updateStatus(tools.length > 0, tools.length > 0 ? 'WebMCP tools available' : 'No tools found');
    }
  });
}

async function initialize() {
  populateVersionLabel();
  setupEventListeners();
  await checkWebMCPStatus();
  await loadTools(false);
}

document.addEventListener('DOMContentLoaded', initialize);
