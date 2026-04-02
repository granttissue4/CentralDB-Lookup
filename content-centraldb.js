// Runs on centraldb.spectrumvoip.com
// Intercepts XHR/fetch calls to grab the Bearer token

(function () {
  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const request = args[0];
    const options = args[1] || {};
    const headers = options.headers || (request instanceof Request ? request.headers : {});

    let token = null;
    if (headers instanceof Headers) {
      token = headers.get('Authorization');
    } else if (typeof headers === 'object') {
      token = headers['Authorization'] || headers['authorization'];
    }

    if (token && token.startsWith('Bearer ')) {
      ext.storage.local.set({ bearerToken: token, tokenSavedAt: Date.now() });
    }

    return originalFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
      ext.storage.local.set({ bearerToken: value, tokenSavedAt: Date.now() });
    }
    return originalSetHeader.apply(this, arguments);
  };
})();
