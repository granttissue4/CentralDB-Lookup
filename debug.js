function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function section(title, rows) {
  return `
    <div class="section">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map(r => `<div class="row">${r}</div>`).join('')}
    </div>`;
}

function ok(label, val) { return `<span class="ok">✅ ${escapeHtml(label)}:</span> <span class="val">${escapeHtml(val)}</span>`; }
function fail(label, val) { return `<span class="fail">❌ ${escapeHtml(label)}:</span> <span class="val">${escapeHtml(val)}</span>`; }
function warn(label, val) { return `<span class="warn">⚠️ ${escapeHtml(label)}:</span> <span class="val">${escapeHtml(val)}</span>`; }
function info(label, val) { return `<span style="color:#64748b">${escapeHtml(label)}:</span> <span class="val">${escapeHtml(val)}</span>`; }

document.getElementById('btn-run').addEventListener('click', async () => {
  const out = document.getElementById('output');
  out.innerHTML = '<div class="section" style="color:#64748b">Running...</div>';

  const results = [];

  // 1. Current tab info
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  results.push(section('📄 Current Tab', [
    info('URL', tab.url),
    info('Host', url.hostname),
    info('Path', url.pathname),
    url.hostname === 'centraldb.spectrumvoip.com'
      ? ok('Site', 'CentralDB ✓')
      : warn('Site', 'Not CentralDB — navigate there first'),
  ]));

  // 2. Saved token in storage
  const stored = await ext.storage.local.get(['bearerToken', 'tokenSavedAt']);
  const token = stored.bearerToken;
  const tokenRows = [];
  if (token) {
    tokenRows.push(ok('Token exists', 'Yes'));
    tokenRows.push(info('Length', token.length + ' chars'));
    tokenRows.push(info('Starts with', token.substring(0, 20) + '...'));
    if (stored.tokenSavedAt) {
      const mins = Math.round((Date.now() - stored.tokenSavedAt) / 60000);
      tokenRows.push(info('Saved', `${mins} minutes ago`));
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const diffMin = Math.round((payload.exp * 1000 - Date.now()) / 60000);
      tokenRows.push(diffMin > 0 ? ok('Expires in', `${diffMin} minutes`) : fail('Expired', `${Math.abs(diffMin)} minutes ago`));
      tokenRows.push(info('User', payload.name || payload.preferred_username || 'unknown'));
    } catch {
      tokenRows.push(warn('JWT decode', 'Failed — may not be a JWT'));
    }
  } else {
    tokenRows.push(fail('Token', 'None saved in storage'));
  }
  results.push(section('🔑 Saved Token', tokenRows));

  // 3. Check content script + window global (only works on centraldb)
  if (url.hostname === 'centraldb.spectrumvoip.com') {
    try {
      const scriptResults = await ext.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            // Check if our intercept is running
            fetchIntercepted: window.fetch.toString().length < 100,
            capturedToken: window.__cdb_captured_token ? window.__cdb_captured_token.substring(0, 30) + '...' : null,
            capturedFull: window.__cdb_captured_token || null,
            // Check localStorage keys
            localStorageKeys: Object.keys(localStorage),
            // Look for any token-like value in localStorage
            msalKeys: Object.keys(localStorage).filter(k => k.toLowerCase().includes('msal')),
            accessTokenKeys: Object.keys(localStorage).filter(k => k.toLowerCase().includes('accesstoken')),
            // Check sessionStorage
            sessionKeys: Object.keys(sessionStorage),
            // Check if MSAL is on window
            msalOnWindow: typeof window.msal !== 'undefined',
            msalPublicClient: typeof window.msalInstance !== 'undefined',
          };
        }
      });

      const d = scriptResults?.[0]?.result;
      if (d) {
        const pageRows = [
          d.fetchIntercepted ? ok('Fetch intercepted', 'Yes') : fail('Fetch intercepted', 'No — content script may not be running'),
          d.capturedToken ? ok('Token captured in window', d.capturedToken) : fail('Token captured', 'None yet — try doing a search on CentralDB'),
          info('localStorage keys total', d.localStorageKeys.length),
          info('MSAL keys', d.msalKeys.length > 0 ? d.msalKeys.length + ' found' : 'none'),
          info('accessToken keys', d.accessTokenKeys.length > 0 ? d.accessTokenKeys.join(', ').substring(0, 80) : 'none'),
          info('sessionStorage keys', d.sessionKeys.length),
          info('window.msal', d.msalOnWindow ? 'present' : 'not found'),
        ];

        // If token was captured, save it!
        if (d.capturedFull) {
          await ext.storage.local.set({ bearerToken: d.capturedFull, tokenSavedAt: Date.now() });
          pageRows.push(ok('AUTO-SAVED', 'Token saved to storage!'));
        }

        results.push(section('🖥️ Page Inspection (CentralDB)', pageRows));

        // Show all localStorage keys for debugging
        if (d.localStorageKeys.length > 0) {
          results.push(section('📦 localStorage Keys', d.localStorageKeys.map(k => info('key', k.substring(0, 80)))));
        }
      }
    } catch (e) {
      results.push(section('🖥️ Page Inspection', [fail('Error', e.message)]));
    }
  } else {
    results.push(section('🖥️ Page Inspection', [warn('Skipped', 'Not on CentralDB — navigate there and run again')]));
  }

  // 4. Test API call if we have a token
  if (token) {
    const apiRows = [];
    try {
      const res = await fetch(`https://centraldb.spectrumvoip.com:8081/api/v1/master-search?search=test&module=connectwise`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      apiRows.push(res.ok ? ok('API response', `HTTP ${res.status} — token works!`) : fail('API response', `HTTP ${res.status} — token rejected`));
    } catch (e) {
      apiRows.push(fail('API call failed', e.message));
    }
    results.push(section('🌐 API Test', apiRows));
  }

  out.innerHTML = results.join('');
});
