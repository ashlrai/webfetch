# MCP Registry Submission

Copy-paste artifacts for submitting webfetch to the two main MCP registries.
`getwebfetch-mcp` is published to npm and can be installed with `npx`.

---

## Section A — modelcontextprotocol/servers

**Target repo:** https://github.com/modelcontextprotocol/servers  
**Category:** `🌐 Web & Browser` (or `🔍 Search` if that category exists in the current README — check alphabetically)  
**Placement:** alphabetical within the category block, after "Vectara" / before "Zapier" depending on live state of the file.

### Exact line to add

```markdown
- [webfetch](https://github.com/ashlrai/webfetch/tree/main/packages/mcp) - License-first image search across 25 providers (Wikimedia, Openverse, Unsplash, Pexels, and more) with per-result open/platform/editorial license tags, attribution lines, and download tooling.
```

> Character count of description: 198. Registry entries typically prefer ≤160 chars. Shorter variant:

```markdown
- [webfetch](https://github.com/ashlrai/webfetch/tree/main/packages/mcp) - Federated image search across 25 providers with license categories, attribution strings, and download — built for agents that need reviewable assets.
```

(157 chars)

### Diff preview

Find the `## 🌐 Web & Browser` (or equivalent) section in the servers README and insert the line alphabetically. Example context:

```diff
 ## 🌐 Web & Browser

 ...
+- [webfetch](https://github.com/ashlrai/webfetch/tree/main/packages/mcp) - Federated image search across 25 providers with license categories, attribution strings, and download — built for agents that need reviewable assets.
 ...
```

---

## Section B — punkpeye/awesome-mcp-servers

**Target repo:** https://github.com/punkpeye/awesome-mcp-servers  
**Category:** `🔍 Search` — webfetch is fundamentally a search tool; the license/download layer is the differentiator, not the primary category.  
**Placement:** alphabetical within the Search section.

### Exact line to add

```markdown
- [webfetch](https://github.com/ashlrai/webfetch/tree/main/packages/mcp) 🏠 ☁️ - License-first federated image search across 25 providers. Every result includes an open/platform/editorial license tag, confidence score, and attribution line ready to render.
```

Awesome-MCP-Servers uses emoji badges: 🏠 = open-source/self-hosted, ☁️ = cloud-optional. webfetch runs locally with optional cloud provider keys — both apply.

### Diff preview

```diff
 ## 🔍 Search

 ...
+- [webfetch](https://github.com/ashlrai/webfetch/tree/main/packages/mcp) 🏠 ☁️ - License-first federated image search across 25 providers. Every result includes an open/platform/editorial license tag, confidence score, and attribution line ready to render.
 ...
```

---

## Section C — PR title and body

Use the same PR text for both registries (adjust repo name in the header).

### PR title

```
feat: add webfetch — license-first image search MCP server
```

### PR body

```markdown
## Summary

**webfetch** is a Model Context Protocol server that exposes license-aware image search to any MCP agent.

### What it does

- Federated search across **25 providers** — Wikimedia Commons, Openverse, Unsplash, Pexels, Pixabay, MusicBrainz CAA, iTunes, Spotify, YouTube thumbnails, Brave, Bing, SerpApi, browser fallback, managed browser fallback, and public-domain/GLAM sources like NASA, The Met, Library of Congress, Internet Archive, Smithsonian, Europeana, Wellcome, Rawpixel, and Burst
- Every result carries a **structured license tag** (`CC0`, `CC_BY`, `UNSPLASH_LICENSE`, `EDITORIAL_LICENSED`, `UNKNOWN`, …), a **confidence score** in [0, 1], and a **ready-to-render attribution line**
- Results with `confidence < 0.5` are excluded from "safe" results by default
- 7 composable tools: `search_images`, `search_artist_images`, `search_album_cover`, `download_image`, `fetch_with_license`, `find_similar`, `probe_page`
- **No API key required** for Wikimedia + Openverse; optional keys unlock additional providers

### Install

```bash
# npm package
npx -y getwebfetch-mcp

# one-line installer (sets up bun, builds server, merges Claude config)
curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh | bash
```

Or add manually to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "bun",
      "args": ["run", "/path/to/webfetch/packages/mcp/src/index.ts"]
    }
  }
}
```

### Checklist

- [x] Server responds to `tools/list` and `tools/call` per MCP spec
- [x] MIT licensed
- [x] README covers install, tools table, env vars, and demo prompts
- [x] Works with Claude Desktop, Cursor, Cline (per docs)
- [x] Published to npm as `getwebfetch-mcp`

### Links

- Repo: https://github.com/ashlrai/webfetch
- Package dir: https://github.com/ashlrai/webfetch/tree/main/packages/mcp
- Landing: https://getwebfetch.com
```

---

## Submission notes

1. **NPM install.**
   `getwebfetch-mcp` is published on npm. Registry reviewers can smoke-test it with:

   ```bash
   npx -y getwebfetch-mcp
   ```

   MCP client config:

   ```json
   {
     "mcpServers": {
       "webfetch": {
         "command": "npx",
         "args": ["-y", "getwebfetch-mcp"]
       }
     }
   }
   ```

2. **Repository URL.**
   Canonical public GitHub URL is `https://github.com/ashlrai/webfetch`; registries link directly to it.

3. **Landing URL.**
   The landing site has the route at `/mcp-registry`, not `/mcp`. Submission copy above links to GitHub directly, which is fine, but the landing URL in the README (`getwebfetch.com`) should route reviewers somewhere meaningful. Verify the canonical marketing URL before submitting.
