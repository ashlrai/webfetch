# webfetch — Chrome extension

MV3 extension that drives the local `@webfetch/server` from the browser.

## Build

```bash
cd extension
bun run icons     # emits placeholder PNGs into icons/
bun run build     # bundles into dist/
```

## Load in Chrome

1. Start the server: `bun run --cwd packages/server src/index.ts`
2. Copy the token from stdout (or from `~/.webfetch/server.token`).
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick the `extension/dist` folder.
4. Open the extension's **Options** page, paste the token, click **save**, then **test connection**.

## Features

| Feature | File |
|---|---|
| Right-click image → "Save with webfetch (with attribution)" | `src/background.ts` |
| Sidebar (Cmd/Ctrl+Shift+F) — search, provider chips, license filter, results grid | `src/content/sidebar.ts` |
| Popup — quick search, server status, recent saves | `src/popup/popup.ts` |
| Options — server URL, token paste, default policy, provider preferences | `src/options/options.ts` |
| HTTP client | `src/shared/api.ts` |

## Sidebar limitation

The sidebar is injected into a shadow DOM to isolate styles, but some sites
with very strict CSP (`trusted-types`, hostile `frame-ancestors`) may still
block content-script UI. On those pages, use the popup instead.
