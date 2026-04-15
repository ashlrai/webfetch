# webfetch for VS Code

License-first federated image search inside your editor. Search 19 providers
(Wikimedia, Openverse, Unsplash, Pexels, Pixabay, Smithsonian, Europeana, NASA,
and more), insert with attribution, and never ship an image of unknown license
to production.

![preview](media/preview.gif)

## Features

- **Side panel** in the Activity Bar — search, filter by license policy, chip
  providers, inspect results with per-image license color badges.
- **Click to insert** — downloads the image into your workspace `./assets/`
  folder (configurable) and inserts `![alt](path)` at the cursor with an
  attribution line.
- **Drag to drop** — drag any result directly into a markdown or HTML file.
- **Context menu** — right-click in a markdown editor → *Insert licensed
  image...* to open the panel seeded with the text under the cursor.
- **Quick-fix lightbulb** — type `![alt]()` in markdown and webfetch offers to
  search for that alt text.
- **XMP sidecar** — every downloaded image can be written with a `.xmp` file
  containing license, author, source URL, and confidence score.
- **Status bar** — green check when connected, warning when the API key is
  missing; click to open settings.

## Commands

| Command | Description |
| --- | --- |
| `webfetch: Search` | Focus the side panel with a query prompt. |
| `webfetch: Insert licensed image...` | Editor context action for markdown. |
| `webfetch: Providers` | Quick-pick listing of connected providers. |
| `webfetch: Set API Key` | Store your API key in VS Code SecretStorage. |
| `webfetch: Open Dashboard` | Open [app.getwebfetch.com](https://app.getwebfetch.com). |

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `webfetch.apiKey` | `""` | Bearer token for the webfetch API (prefer `Set API Key`). |
| `webfetch.baseUrl` | `https://api.getwebfetch.com` | Set to `http://127.0.0.1:7600` for self-hosted. |
| `webfetch.defaultLicense` | `safe-only` | `safe-only` / `prefer-safe` / `any`. |
| `webfetch.defaultProviders` | `[]` | Subset of the 19 providers to query (empty = server defaults). |
| `webfetch.outputDir` | `./assets` | Where downloaded images land, relative to the workspace root. |
| `webfetch.writeXmpSidecar` | `true` | Write `<image>.xmp` alongside each download. |
| `webfetch.attributionStyle` | `html-comment` | `html-comment` / `markdown-caption` / `none`. |

## Self-host

Run [`@webfetch/server`](https://github.com/ashlrai/webfetch) locally:

```
npx @webfetch/server --port 7600 --token $(uuidgen)
```

Then set `webfetch.baseUrl` to `http://127.0.0.1:7600` and paste the token via
*webfetch: Set API Key*.

## License

MIT © Ashlar AI
