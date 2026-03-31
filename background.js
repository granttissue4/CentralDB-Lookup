// Background service worker — stays alive even when popup is closed
// Listens for token messages from content script via chrome.runtime

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cdb-search-selection',
      title: 'Search CentralDB for "%s"',
      contexts: ['selection'],
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CDB_TOKEN' && msg.token) {
    chrome.storage.local.set({ bearerToken: msg.token, tokenSavedAt: Date.now() });
  }
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'cdb-search-selection') return;

  const query = info.selectionText?.trim();
  if (!query) return;

  // Show searching state on badge
  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });

  const stored = await chrome.storage.local.get('bearerToken');
  const token = stored.bearerToken;

  // No token — store pending search, badge yellow to signal popup needed
  if (!token) {
    await chrome.storage.local.set({ pendingSearch: query });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    return;
  }

  // Check expiry
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]));
    if (exp * 1000 < Date.now()) {
      await chrome.storage.local.remove('bearerToken');
      await chrome.storage.local.set({ pendingSearch: query });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      return;
    }
  } catch(_) {}

  // Fire the search
  const API_BASE = 'https://centraldb.spectrumvoip.com:8081/api/v1/master-search';
  try {
    const res = await fetch(`${API_BASE}?search=${encodeURIComponent(query)}&module=connectwise`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const json = await res.json();
    const results = json?.data?.companies?.data || [];

    // Store results and badge green — user clicks icon to see results
    await chrome.storage.local.set({
      contextMenuResults: { query, results, timestamp: Date.now() }
    });
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });

  } catch(e) {
    await chrome.storage.local.set({
      contextMenuResults: { query, results: [], error: e.message, timestamp: Date.now() }
    });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
});