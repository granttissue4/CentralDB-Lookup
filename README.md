# CentralDB Lookup (browser extension)

Manifest V3 extension that saves a CentralDB bearer token and runs company lookups from Stratus portal tabs, with optional context-menu search.

This repository is a **fork** of an extension originally built by a colleague. This fork adds cross-browser support (Chrome + Firefox), security hardening for untrusted page/API data, and maintenance docs. **Replace the placeholder below** with your friend’s name and upstream URL when you have them.

**Upstream / attribution:** Original author: _(add name)_. Original source: _(add repo URL if public)_. Fork changes include Firefox MV3 `background.scripts` + Chromium `service_worker`, `ext-api.js` shim, DOM-safe popup rendering, JWT validation on token bridge events, and stricter message handling in the background script.

> If the original project used a different license, reconcile [LICENSE](LICENSE) with that upstream license before redistributing.

## Requirements

- **Google Chrome** or **Chromium** (recent MV3-capable build), or **Mozilla Firefox 128+** (Gecko `strict_min_version` in `manifest.json`; needed for `scripting.executeScript` with `world: "MAIN"` for token decryption).

## Install (development)

### Chrome / Chromium

1. Open `chrome://extensions` (or `edge://extensions` in Microsoft Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (the directory that contains `manifest.json`).

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Under **Temporary Extensions**, click **Load Temporary Add-on…** and choose `manifest.json`.

Temporary add-ons in Firefox are removed when the browser fully exits; load again as needed, or use a signed package for persistence.

## Permissions and host access

| Manifest piece | Why it’s there |
|----------------|----------------|
| `activeTab` | Run `scripting.executeScript` in the active tab for portal DOM reads and CentralDB token extraction. |
| `storage` | Save bearer token, pending/context-menu search results, timestamps. |
| `scripting` | Inject scripts into allowed tabs (including `MAIN` world on CentralDB for MSAL/token reads). |
| `contextMenus` | “Search CentralDB for selection” background action. |
| **Host permissions** (CentralDB + Stratus + `st1-*` hosts) | Call your org APIs and match portal origins used in the popup’s allowlist. |

## Icons

`icons/icon16.png`, `icon48.png`, and `icon128.png` are simple solid placeholders so the manifest validates. Swap them for branded artwork before any public store submission.

## Optional developer diagnostics

`debug.html` / `debug.js` are **not** registered in `manifest.json`. They are only useful when opened in a dev context alongside the extension APIs (e.g. while iterating locally). Do not rely on them in production builds; omit them from zip bundles you give to non-developers if you want a minimal package.

## Smoke checklist (after any change)

Run through this on **both** Chrome and Firefox after edits, especially to `manifest.json`, `background.js`, `popup.js`, or `ext-api.js`:

1. Reload the extension.
2. On **CentralDB** (`centraldb.spectrumvoip.com`): open the popup, **Token** tab — grab or confirm token.
3. On a **Stratus portal** tab (`/portal` path, host in `PORTAL_HOSTS` in `popup.js`): open popup, run **Search**.
4. Select text on a page, context menu → **Search CentralDB for …**, then open the popup and confirm results or badge state.

## Versioning

Bump `"version"` in `manifest.json` whenever you hand a build to someone else (semver: `MAJOR.MINOR.PATCH`). Record changes in [CHANGELOG.md](CHANGELOG.md).

## Syncing from upstream (friend’s repo)

If the original project lives in a Git remote you can merge from:

1. Add the remote once:  
   `git remote add upstream https://example.com/original/centraldb-extension.git`  
   (use the real URL.)
2. Fetch: `git fetch upstream`
3. Merge or cherry-pick:  
   `git merge upstream/main`  
   (or their default branch name), or cherry-pick specific commits.
4. **Resolve conflicts** carefully in files this fork changed heavily: `manifest.json`, `background.js`, `popup.js`, `bridge.js`, `ext-api.js`.
5. Run the **smoke checklist** above on Chrome and Firefox before sharing the build.

If there is no public upstream, skip this section.

## Project layout (short)

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest; Gecko + dual `background` for Firefox/Chrome |
| `ext-api.js` | `globalThis.ext = browser \|\| chrome` for content scripts, popup, debug |
| `background.js` | Context menus, context-menu API search, badge, storage |
| `popup.html` / `popup.js` | Main UI, search, token grab (MSAL decrypt) |
| `bridge.js` | Isolated world listener for token events |
| `content-centraldb.js` | CentralDB page: intercept fetch/XHR for bearer token |

## License

See [LICENSE](LICENSE). Align with the original author’s wishes if their project specified a different license.
