# CentralDB Lookup — Edge Extension

A Microsoft Edge browser extension for SpectrumVoIP support staff. When you're viewing a customer account in the Stratus portal, it automatically searches CentralDB and returns the matching ConnectWise company — bridging the gap between Stratus customer names and ConnectWise account names.

---

## The Problem

Customer names in **Stratus** often don't match the names in **ConnectWise** (our ticketing software). Finding the right ConnectWise account means manually copying the domain or company name, opening CentralDB, and searching — every single time.

## The Solution

Open the extension while on a Stratus portal tab. It reads the customer name and domain from the page, searches CentralDB automatically, and shows you the matching ConnectWise company — including the CW ID you need to pull up the right ticket.

---

## Features

- **Auto-detects** customer name and domain from the active Stratus portal tab
- **Auto-grabs your auth token** from CentralDB using MSAL cache decryption — no manual copy/paste
- **Token status indicator** — shows time remaining before expiry with color-coded dot (green / yellow / red)
- **Manual token fallback** — paste a Bearer token directly if auto-grab fails
- **Result cards** — shows company name, billing domain, phone, billing status, and ConnectWise ID
- **Deduplication** — searches by both company name and domain, merges and dedupes results by ID

---

## How It Works

### Token Acquisition

CentralDB authenticates via **Microsoft MSAL (Azure AD)**. The token is stored in the browser encrypted — the encrypted blob lives in `localStorage` and the decryption key lives in a cookie. Neither is useful alone.

When you open the extension on the CentralDB tab, it:

1. Reads the encrypted token entry from `localStorage`
2. Reads the encryption key from the `msal.cache.encryption` cookie
3. Derives a final AES key using **HKDF (SHA-256)**
4. Decrypts the token using **AES-GCM**
5. Saves the resulting JWT to `chrome.storage.local`

The token is a standard JWT — the extension reads the `exp` claim to display how much time is left before it expires (typically ~84 minutes).

### Page Scraping (Stratus Portal)

On portal tabs, the extension reads:
- **Company name** from `.domain-description`
- **Domain** from `.domain-message-text` — extracted via regex targeting a valid domain pattern (e.g. `example.com`)

### Search

Both the company name and domain are sent as parallel requests to:
```
GET https://centraldb.spectrumvoip.com:8081/api/v1/master-search?search=<query>&module=connectwise
```
Results are merged and deduplicated by ConnectWise company ID.

---

## Installation

> This extension is not published to the Edge Add-ons store. Install it in Developer Mode.

1. Download and unzip the extension folder
2. Open Edge and navigate to `edge://extensions`
3. Enable **Developer mode** (toggle in the bottom-left)
4. Click **Load unpacked**
5. Select the unzipped `centraldb-fixed` folder
6. The extension icon will appear in your toolbar

---

## Usage

### First Time — Grab a Token

1. Open a new tab and navigate to `centraldb.spectrumvoip.com`
2. Let the page fully load
3. Click the extension icon — it will **auto-grab the token** from the page
4. The token bar will turn green with time remaining

> **Token expiring?** Go back to the CentralDB tab, do anything that triggers an API call (search, navigate), or hard refresh (`Ctrl+Shift+R`). The extension intercepts the token automatically.

### Searching

1. Navigate to a customer account in the **Stratus portal**
2. Click the extension icon
3. The detected company name and domain will appear
4. Click **Search CentralDB**
5. Matching ConnectWise companies appear as result cards

---

## File Structure

```
centraldb-fixed/
├── manifest.json          # Extension config, permissions, content script declarations
├── popup.html             # Extension popup UI
├── popup.js               # Main logic — token grab, page scrape, search, render
├── background.js          # Service worker — persists token messages to storage
├── bridge.js              # Isolated world bridge — relays token events to chrome.storage
├── content.js             # Injected on CentralDB — floating "Copy Token" button + interceptors
├── content-centraldb.js   # Injected on CentralDB at document_start — fetch/XHR interceptors
├── debug.html             # Debug panel UI
├── debug.js               # Debug tooling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Read page content from the current tab |
| `storage` | Save the Bearer token between popup opens |
| `scripting` | Execute scripts on CentralDB/Stratus tabs to grab token and scrape page |
| Host permissions | Scope access to SpectrumVoIP domains only |

---

## Security Notes

- The Bearer token is stored **locally in your browser only** (`chrome.storage.local`) — it is never sent to any external server
- The token is only used to authenticate requests to `centraldb.spectrumvoip.com` — the same destination you'd use manually
- Tokens expire automatically (~84 minutes based on Azure AD configuration)
- Do not share the extension with a token already saved in storage, and avoid pasting tokens into chat or tickets

---

## Troubleshooting

| Issue | Fix |
|---|---|
| HTTP 500 on search | Grab a fresh token from the CentralDB tab |
| "No token saved" | Navigate to CentralDB, open the popup, token should auto-grab |
| Token time not updating | Trigger an API call on the CentralDB tab (search something) or hard refresh (`Ctrl+Shift+R`) |
| Nothing detected on page | The portal page selector may not match — check that you're on an active domain/account page |
| Domain extracted incorrectly | Ensure the page text contains a valid domain in parentheses e.g. `(example.com)` |
