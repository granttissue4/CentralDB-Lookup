// Runs in ISOLATED world — can access ext.storage
// Listens for token events dispatched by the MAIN world content script (if present).
// Only persist values that look like JWT access tokens to limit DOM-based poisoning.
function normalizeBearerToken(detail) {
  if (typeof detail !== 'string') return null;
  const raw = detail.trim().replace(/^[Bb]earer\s+/, '');
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some((p) => !p.length)) return null;
  return raw;
}

document.addEventListener('__cdb_save_token', (e) => {
  const token = normalizeBearerToken(e.detail);
  if (token) {
    ext.storage.local.set({ bearerToken: token, tokenSavedAt: Date.now() });
  }
});
