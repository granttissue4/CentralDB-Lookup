// Chromium MV3: service worker loads shim via importScripts. Firefox MV3 uses
// manifest `background.scripts` (ext-api.js then this file); no importScripts there.
if (typeof importScripts === 'function') {
  importScripts('ext-api.js');
}

// Background — ext.runtime (Chromium SW + Firefox background scripts)

async function ensureContextMenu() {
  await ext.contextMenus.removeAll();
  await ext.contextMenus.create({
    id: 'cdb-search-selection',
    title: 'Search CentralDB for "%s"',
    contexts: ['selection'],
  });
}

ext.runtime.onInstalled.addListener(() => {
  void ensureContextMenu().catch(() => {});
});

ext.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'CDB_TOKEN' && msg.token && sender.id === ext.runtime.id) {
    ext.storage.local.set({ bearerToken: msg.token, tokenSavedAt: Date.now() });
  }
});

// Handle context menu click
ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'cdb-search-selection') return;

  const query = info.selectionText?.trim();
  if (!query) return;

  ext.action.setBadgeText({ text: '...' });
  ext.action.setBadgeBackgroundColor({ color: '#3b82f6' });

  const stored = await ext.storage.local.get('bearerToken');
  const token = stored.bearerToken;

  if (!token) {
    await ext.storage.local.set({ pendingSearch: query });
    ext.action.setBadgeText({ text: '!' });
    ext.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    return;
  }

  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]));
    if (exp * 1000 < Date.now()) {
      await ext.storage.local.remove('bearerToken');
      await ext.storage.local.set({ pendingSearch: query });
      ext.action.setBadgeText({ text: '!' });
      ext.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      return;
    }
  } catch (_) {}

  const API_BASE = 'https://centraldb.spectrumvoip.com:8081/api/v1/master-search';
  try {
    const res = await fetch(`${API_BASE}?search=${encodeURIComponent(query)}&module=connectwise`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const json = await res.json();
    const results = json?.data?.companies?.data || [];

    await ext.storage.local.set({
      contextMenuResults: { query, results, timestamp: Date.now() },
    });
    ext.action.setBadgeText({ text: '●' });
    ext.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } catch (e) {
    await ext.storage.local.set({
      contextMenuResults: { query, results: [], error: e.message, timestamp: Date.now() },
    });
    ext.action.setBadgeText({ text: '!' });
    ext.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
});

void ensureContextMenu().catch(() => {});
