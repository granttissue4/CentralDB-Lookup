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

function appendMsgBox(container, className, text) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  container.replaceChildren(div);
}

function appendSearchHintNoPortal(container) {
  const div = document.createElement('div');
  div.className = 'msg msg-info';
  div.appendChild(document.createTextNode('Navigate to a '));
  const strong = document.createElement('strong');
  strong.textContent = 'Stratus portal';
  div.appendChild(strong);
  div.appendChild(document.createTextNode(' tab to search.'));
  container.replaceChildren(div);
}

function appendSearchHintNoToken(container) {
  const div = document.createElement('div');
  div.className = 'msg msg-info';
  div.appendChild(document.createTextNode('No token saved. Go to CentralDB tab and click the '));
  const strong = document.createElement('strong');
  strong.textContent = 'Token tab → Grab Token';
  div.appendChild(strong);
  div.appendChild(document.createTextNode('.'));
  container.replaceChildren(div);
}

async function grabToken(tabId) {
  const pageData = await ext.scripting.executeScript({
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
  await ext.storage.local.set({ bearerToken: token, tokenSavedAt: Date.now() });
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


// Fetches all projects once and caches them in memory for the popup session.
// Since the endpoint doesn't support companyId filtering server-side, we pull
// everything (limit=5000 gets all ~4,458 in one shot) and filter client-side.
let _projectsCache = null;

async function projectsAPI(companyId, token) {
  if (!_projectsCache) {
    const res = await fetch(
      `https://centraldb.spectrumvoip.com:8081/api/v1/connectwise/projects?limit=5000&page=1&sortBy=estimatedStart&sortDirection=desc`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    _projectsCache = json?.data?.data || [];
  }
  return _projectsCache.filter(p => p.CompanyId === companyId);
}

function dedupeById(arr) {
  const seen = new Set();
  return arr.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
}

// Maps CentralDB's status_name strings to a color for the status badge.
// Statuses follow a numbering convention — we key off the number prefix.
function projectStatusColor(status) {
  if (!status) return '#64748b';
  const s = status.trim().toLowerCase();
  if (s.startsWith('2.')) return '#22c55e';  // In Progress — green
  if (s.startsWith('1')) return '#3b82f6';   // New / Assigned — blue
  if (s.startsWith('8.')) return '#475569';  // Closed — grey
  if (s.startsWith('7.')) return '#ef4444';  // Cancelled — red
  if (s.startsWith('0.')) return '#f59e0b';  // Credit not approved — yellow
  if (s.startsWith('9.')) return '#8b5cf6';  // Demo — purple
  return '#64748b'; // fallback
}

function createResultCard(c) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const cname = document.createElement('div');
  cname.className = 'cname';
  cname.textContent = c.name || '—';
  card.appendChild(cname);

  function addLabeledRow(label, text) {
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(document.createTextNode(label));
    const span = document.createElement('span');
    span.textContent = text || '—';
    row.appendChild(span);
    card.appendChild(row);
  }

  addLabeledRow('Domain: ', c.Billing_Domain);
  addLabeledRow('Phone: ', c.phoneNumber);

  const statusRow = document.createElement('div');
  statusRow.className = 'row';
  statusRow.appendChild(document.createTextNode('Status: '));
  const statusSpan = document.createElement('span');
  statusSpan.className = c.Billing_Status === 'OPEN' ? 'status-open' : 'status-other';
  statusSpan.textContent = c.Billing_Status || '—';
  statusRow.appendChild(statusSpan);
  card.appendChild(statusRow);

  addLabeledRow('CW ID: ', c.id != null ? String(c.id) : null);

  const btn = document.createElement('button');
  btn.className = 'projects-toggle';
  btn.setAttribute('data-cwid', String(c.id ?? ''));
  btn.textContent = '📋 Load Projects';
  card.appendChild(btn);

  const projSec = document.createElement('div');
  projSec.className = 'projects-section';
  projSec.style.display = 'none';
  card.appendChild(projSec);

  return card;
}

/** @returns {DocumentFragment} */
function renderCards(companies, company, domain) {
  const frag = document.createDocumentFragment();
  if (!companies.length) {
    const d = document.createElement('div');
    d.className = 'msg msg-info';
    d.textContent = `No results for "${company || ''}${domain ? ` or ${domain}` : ''}"`;
    frag.appendChild(d);
    return frag;
  }
  for (const c of companies) {
    frag.appendChild(createResultCard(c));
  }
  return frag;
}

function buildPortalSearchContent(company, domain, onSearchReady) {
  const searchContent = document.getElementById('search-content');
  searchContent.replaceChildren();

  const box = document.createElement('div');
  box.className = 'info-box';
  const lbl = document.createElement('div');
  lbl.className = 'lbl';
  lbl.textContent = 'Detected on page';
  const val = document.createElement('div');
  val.className = 'val';
  if (company) {
    val.textContent = company;
  } else {
    const muted = document.createElement('span');
    muted.style.color = '#4b5563';
    muted.textContent = 'Could not detect';
    val.appendChild(muted);
  }
  const sub = document.createElement('div');
  sub.className = 'sub';
  if (domain) sub.textContent = `(${domain})`;
  box.appendChild(lbl);
  box.appendChild(val);
  box.appendChild(sub);

  const btn = document.createElement('button');
  btn.className = 'btn btn-blue';
  btn.id = 'btn-search';
  const canSearch = !!(company || domain);
  btn.disabled = !canSearch;
  btn.textContent = canSearch ? '🔍 Search CentralDB' : '⚠️ Nothing detected';

  const results = document.createElement('div');
  results.id = 'results';

  searchContent.appendChild(box);
  searchContent.appendChild(btn);
  searchContent.appendChild(results);

  onSearchReady(btn, results);
}

(async () => {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  const isCentralDB = url.hostname === 'centraldb.spectrumvoip.com';
  const isPortal = PORTAL_HOSTS.includes(url.hostname) && url.pathname.includes('/portal');

  const stored = await ext.storage.local.get('bearerToken');
  let savedToken = stored.bearerToken || null;

  // Evict expired token rather than leaving a stale credential in storage
  if (savedToken) {
    try {
      const { exp } = JSON.parse(atob(savedToken.split('.')[1]));
      if (exp * 1000 < Date.now()) {
        await ext.storage.local.remove('bearerToken');
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
      appendMsgBox(tokenMsg, 'msg msg-error', '❌ You need to be on the CentralDB tab to grab the token.');
      return;
    }
    grabBtn.disabled = true;
    grabBtn.textContent = '⏳ Grabbing...';
    tokenMsg.replaceChildren();
    try {
      const token = await grabToken(tab.id);
      savedToken = token;
      updateTokenBar(token);
      appendMsgBox(tokenMsg, 'msg msg-success', '✅ Token grabbed automatically!');
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
      appendMsgBox(tokenMsg, 'msg msg-success', '✅ Token auto-grabbed!');
    } catch(_) {
      // Silent fail — user can click manually
    }
  }

  // Manual paste fallback
  document.getElementById('btn-save-token').addEventListener('click', async () => {
    let raw = document.getElementById('token-input').value.trim().replace(/^[Bb]earer\s+/, '');
    if (!raw) return;
    await ext.storage.local.set({ bearerToken: raw, tokenSavedAt: Date.now() });
    savedToken = raw;
    updateTokenBar(raw);
    document.getElementById('token-input').value = '';
    appendMsgBox(tokenMsg, 'msg msg-success', '✅ Token saved!');
    setTimeout(() => switchTab('search'), 1000);
  });

  document.getElementById('btn-clear-token').addEventListener('click', async () => {
    await ext.storage.local.remove('bearerToken');
    savedToken = null;
    updateTokenBar(null);
    appendMsgBox(tokenMsg, 'msg msg-info', 'Token cleared.');
  });

  // ── Search panel ──────────────────────────────────────────
  const searchContent = document.getElementById('search-content');

  // Pick up any recent context menu search results (within last 60s)
  const { pendingSearch, contextMenuResults } = await ext.storage.local.get(['pendingSearch', 'contextMenuResults']);

  if (pendingSearch) {
    ext.storage.local.remove('pendingSearch');
  }

  if (contextMenuResults && Date.now() - contextMenuResults.timestamp < 60000) {
    ext.storage.local.remove('contextMenuResults');
    ext.action.setBadgeText({ text: '' });
    switchTab('search');
    searchContent.replaceChildren();
    const box = document.createElement('div');
    box.className = 'info-box';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = 'Context menu search';
    const val = document.createElement('div');
    val.className = 'val';
    val.textContent = contextMenuResults.query ?? '';
    box.appendChild(lbl);
    box.appendChild(val);
    const results = document.createElement('div');
    results.id = 'results';
    results.replaceChildren(renderCards(contextMenuResults.results, contextMenuResults.query, null));
    searchContent.appendChild(box);
    searchContent.appendChild(results);
  } else if (!isPortal) {
    appendSearchHintNoPortal(searchContent);
  } else if (!savedToken) {
    appendSearchHintNoToken(searchContent);
  } else {
    let company = null, domain = null;
    try {
      const res = await ext.scripting.executeScript({
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

    buildPortalSearchContent(company, domain, (btn, resultsEl) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.replaceChildren();
        const spin = document.createElement('span');
        spin.className = 'spinner';
        btn.appendChild(spin);
        btn.appendChild(document.createTextNode('Searching...'));

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
          resultsEl.replaceChildren(renderCards(dedupeById([...byName, ...byDomain]), company, domain));
        } catch(e) {
          const errDiv = document.createElement('div');
          errDiv.className = 'msg msg-error';
          errDiv.textContent = `❌ ${e.message} — Try grabbing a fresh token.`;
          resultsEl.replaceChildren(errDiv);
        }
        btn.disabled = false;
        btn.textContent = '🔍 Search Again';
      });
    });
  }
})();