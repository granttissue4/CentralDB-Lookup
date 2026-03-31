const PORTAL_HOSTS = [
  'stratus.spectrumvoip.com',
  'st1-web3-cl4.spectrumvoip.com',
  'st1-web4-cl4.spectrumvoip.com',
  'st1-web5-lax.spectrumvoip.com',
  'st1-web6-dal.spectrumvoip.com',
  'st1-*.spectrumvoip.com'
];
const API_BASE = 'https://centraldb.spectrumvoip.com:8081/api/v1/master-search';

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function decryptMSALToken(baseKey, nonce, data, clientId) {
  const hkdfKey = await crypto.subtle.importKey('raw', b64urlToBytes(baseKey), 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: b64urlToBytes(nonce), info: new TextEncoder().encode(clientId) },
    hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, aesKey, b64urlToBytes(data));
  const plaintext = new TextDecoder().decode(decrypted);
  try {
    const parsed = JSON.parse(plaintext);
    return parsed.secret || parsed.token || parsed.access_token || null;
  } catch {
    return plaintext.trim().startsWith('eyJ') ? plaintext.trim() : null;
  }
}

function updateTokenBar(token) {
  const dot = document.getElementById('tok-dot');
  const label = document.getElementById('tok-label');
  const time = document.getElementById('tok-time');
  if (!token) { dot.className = 'dot'; label.textContent = 'No token'; time.textContent = ''; return; }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const diffMin = Math.round((payload.exp * 1000 - Date.now()) / 60000);
    if (diffMin <= 0) { dot.className = 'dot'; label.textContent = 'Token expired'; time.textContent = 'Grab again'; }
    else if (diffMin < 10) { dot.className = 'dot yellow'; label.textContent = `Expiring in ${diffMin}m`; time.textContent = '⚠️'; }
    else { dot.className = 'dot green'; label.textContent = 'Token valid'; time.textContent = `~${diffMin}m left`; }
  } catch { dot.className = 'dot green'; label.textContent = 'Token saved'; time.textContent = ''; }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}
window.switchTab = switchTab;

async function grabToken(tabId) {
  const pageData = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      try {
        const cookieMatch = document.cookie.match(/msal\.cache\.encryption=([^;]+)/);
        if (!cookieMatch) return { error: 'No msal.cache.encryption cookie' };
        const enc = JSON.parse(decodeURIComponent(cookieMatch[1]));
        const lsKeys = Object.keys(localStorage);
        const tokenKeysKey = lsKeys.find(k => k.startsWith('msal.1.token.keys.'));
        const clientId = tokenKeysKey ? tokenKeysKey.replace('msal.1.token.keys.', '') : '';
        const tokenKey = lsKeys.find(k => k.toLowerCase().includes('accesstoken'));
        if (!tokenKey) return { error: 'No accesstoken in localStorage' };
        const entry = JSON.parse(localStorage.getItem(tokenKey));
        return { baseKey: enc.key, nonce: entry.nonce, data: entry.data, clientId };
      } catch(e) { return { error: e.message }; }
    }
  });
  const pd = pageData?.[0]?.result;
  if (pd?.error) throw new Error(pd.error);
  const token = await decryptMSALToken(pd.baseKey, pd.nonce, pd.data, pd.clientId);
  if (!token) throw new Error('Decryption succeeded but no token found');
  await chrome.storage.local.set({ bearerToken: token, tokenSavedAt: Date.now() });
  return token;
}

async function searchAPI(query, token) {
  const res = await fetch(`${API_BASE}?search=${encodeURIComponent(query)}&module=connectwise`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.data?.companies?.data || [];
}

function dedupeById(arr) {
  const seen = new Set();
  return arr.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
}

function renderCards(companies, company, domain) {
  if (!companies.length) {
    const d = document.createElement('div');
    d.className = 'msg msg-info';
    d.textContent = `No results for "${company || ''}${domain ? ` or ${domain}` : ''}"`;
    return d.outerHTML;
  }
  return companies.map(c => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const t = (val, fallback = '—') => {
      const s = document.createElement('span');
      s.textContent = val || fallback;
      return s.outerHTML;
    };

    const statusClass = c.Billing_Status === 'OPEN' ? 'status-open' : 'status-other';

    card.innerHTML = `
      <div class="cname"></div>
      <div class="row">Domain: ${t(c.Billing_Domain)}</div>
      <div class="row">Phone: ${t(c.phoneNumber)}</div>
      <div class="row">Status: <span class="${statusClass}"></span></div>
      <div class="row">CW ID: ${t(c.id)}</div>`;

    card.querySelector('.cname').textContent = c.name || '—';
    card.querySelector(`.${statusClass}`).textContent = c.Billing_Status || '—';

    return card.outerHTML;
  }).join('');
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  const isCentralDB = url.hostname === 'centraldb.spectrumvoip.com';
  const isPortal = PORTAL_HOSTS.includes(url.hostname) && url.pathname.includes('/portal');

  const stored = await chrome.storage.local.get('bearerToken');
  let savedToken = stored.bearerToken || null;

  // Evict expired token rather than leaving a stale credential in storage
  if (savedToken) {
    try {
      const { exp } = JSON.parse(atob(savedToken.split('.')[1]));
      if (exp * 1000 < Date.now()) {
        await chrome.storage.local.remove('bearerToken');
        savedToken = null;
      }
    } catch(_) {} // non-JWT token — leave it alone
  }

  updateTokenBar(savedToken);

  document.getElementById('tab-search').addEventListener('click', () => switchTab('search'));
  document.getElementById('tab-token').addEventListener('click', () => switchTab('token'));

  document.getElementById('subtitle').textContent = isCentralDB ? 'CentralDB' : isPortal ? 'Stratus Portal' : url.hostname;

  // ── Token panel ───────────────────────────────────────────
  const grabBtn = document.getElementById('btn-grab-token');
  const tokenMsg = document.getElementById('token-msg');

  grabBtn.addEventListener('click', async () => {
    if (!isCentralDB) {
      tokenMsg.innerHTML = `<div class="msg msg-error">❌ You need to be on the CentralDB tab to grab the token.</div>`;
      return;
    }
    grabBtn.disabled = true;
    grabBtn.textContent = '⏳ Grabbing...';
    tokenMsg.innerHTML = '';
    try {
      const token = await grabToken(tab.id);
      savedToken = token;
      updateTokenBar(token);
      tokenMsg.innerHTML = `<div class="msg msg-success">✅ Token grabbed automatically!</div>`;
      grabBtn.textContent = '⚡ Grab Again';
      setTimeout(() => switchTab('search'), 1000);
    } catch(e) {
      const errDiv = document.createElement('div');
      errDiv.className = 'msg msg-error';
      errDiv.textContent = `❌ ${e.message}`;
      tokenMsg.replaceChildren(errDiv);
      grabBtn.textContent = '⚡ Try Again';
    }
    grabBtn.disabled = false;
  });

  // Auto-grab if on CentralDB and no valid token
  if (isCentralDB) {
    try {
      const token = await grabToken(tab.id);
      savedToken = token;
      updateTokenBar(token);
      tokenMsg.innerHTML = `<div class="msg msg-success">✅ Token auto-grabbed!</div>`;
    } catch(_) {
      // Silent fail — user can click manually
    }
  }

  // Manual paste fallback
  document.getElementById('btn-save-token').addEventListener('click', async () => {
    let raw = document.getElementById('token-input').value.trim().replace(/^[Bb]earer\s+/, '');
    if (!raw) return;
    await chrome.storage.local.set({ bearerToken: raw, tokenSavedAt: Date.now() });
    savedToken = raw;
    updateTokenBar(raw);
    document.getElementById('token-input').value = '';
    tokenMsg.innerHTML = `<div class="msg msg-success">✅ Token saved!</div>`;
    setTimeout(() => switchTab('search'), 1000);
  });

  document.getElementById('btn-clear-token').addEventListener('click', async () => {
    await chrome.storage.local.remove('bearerToken');
    savedToken = null;
    updateTokenBar(null);
    tokenMsg.innerHTML = `<div class="msg msg-info">Token cleared.</div>`;
  });

  // ── Search panel ──────────────────────────────────────────
  const searchContent = document.getElementById('search-content');

  // Pick up any recent context menu search results (within last 60s)
  const { pendingSearch, contextMenuResults } = await chrome.storage.local.get(['pendingSearch', 'contextMenuResults']);

  if (pendingSearch) {
    chrome.storage.local.remove('pendingSearch');
  }

  if (contextMenuResults && Date.now() - contextMenuResults.timestamp < 60000) {
      chrome.storage.local.remove('contextMenuResults');
      chrome.action.setBadgeText({ text: '' }); // ← add this line
      switchTab('search');
    searchContent.innerHTML = `
      <div class="info-box">
        <div class="lbl">Context menu search</div>
        <div class="val"></div>
      </div>
      <div id="results"></div>`;
    // textContent for query — never innerHTML
    searchContent.querySelector('.val').textContent = contextMenuResults.query;
    searchContent.querySelector('#results').innerHTML = renderCards(
      contextMenuResults.results,
      contextMenuResults.query,
      null
    );
  } else if (!isPortal) {
    searchContent.innerHTML = `<div class="msg msg-info">Navigate to a <strong>Stratus portal</strong> tab to search.</div>`;
  } else if (!savedToken) {
    searchContent.innerHTML = `<div class="msg msg-info">No token saved. Go to CentralDB tab and click the <strong>Token tab → Grab Token</strong>.</div>`;
  } else {
    let company = null, domain = null;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const company = document.querySelector('.domain-description')?.textContent?.trim() || null;
          const text = document.querySelector('.domain-message-text')?.textContent || '';
          const domain = (text.match(/\(([a-z0-9.-]+\.[a-z]{2,})\)/i) || [])[1]?.trim() || null;
          return { company, domain };
        }
      });
      company = res?.[0]?.result?.company || null;
      domain = res?.[0]?.result?.domain || null;
    } catch(_) {}

    searchContent.innerHTML = `
      <div class="info-box">
        <div class="lbl">Detected on page</div>
        <div class="val">${company || '<span style="color:#4b5563">Could not detect</span>'}</div>
        <div class="sub">${domain ? `(${domain})` : ''}</div>
      </div>
      <button class="btn btn-blue" id="btn-search" ${!company && !domain ? 'disabled' : ''}>
        ${!company && !domain ? '⚠️ Nothing detected' : '🔍 Search CentralDB'}
      </button>
      <div id="results"></div>`;

    document.getElementById('btn-search')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-search');
      const resultsEl = document.getElementById('results');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Searching...';

      // Token expiry preflight
      try {
        const { exp } = JSON.parse(atob(savedToken.split('.')[1]));
        if (exp * 1000 < Date.now()) {
          const errDiv = document.createElement('div');
          errDiv.className = 'msg msg-error';
          errDiv.textContent = '⚠️ Token is expired. Grab a fresh one from the Token tab.';
          resultsEl.replaceChildren(errDiv);
          btn.disabled = false;
          btn.textContent = '🔍 Search Again';
          return;
        }
      } catch(_) {}

      try {
        const [byName, byDomain] = await Promise.all([
          company ? searchAPI(company, savedToken) : Promise.resolve([]),
          domain  ? searchAPI(domain,  savedToken) : Promise.resolve([])
        ]);
        resultsEl.innerHTML = renderCards(dedupeById([...byName, ...byDomain]), company, domain);
      } catch(e) {
        const errDiv = document.createElement('div');
        errDiv.className = 'msg msg-error';
        errDiv.textContent = `❌ ${e.message} — Try grabbing a fresh token.`;
        resultsEl.replaceChildren(errDiv);
      }
      btn.disabled = false;
      btn.textContent = '🔍 Search Again';
    });
  }
})();