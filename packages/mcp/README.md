# webfetch MCP

License-first image search and download for any MCP-speaking agent.

Every result ships with a structured license tag (`CC0`, `CC_BY`, `CC_BY_SA`, `EDITORIAL_LICENSED`, …), a confidence score, and a ready-to-render attribution line. No result with `confidence < 0.5` ever reaches you as "safe." Covers 24 providers, with 19 in the default set — no API key needed for Wikimedia Commons, Openverse, iTunes, MusicBrainz CAA, NASA, The Met, Library of Congress, Internet Archive, Wellcome Collection, and Burst.

---

## Why webfetch MCP?

Most image-search tools give you URLs. webfetch gives you URLs **plus** the legal metadata that determines whether you can ship them. The MCP layer exposes seven composable tools — search, specialize by artist/album, download with a hash, resolve an arbitrary URL's license, reverse-image-search, and triage a source page — so an agent can go from prompt to attributed asset in a single conversation turn.

- **24 providers**, 19 in the default set and many requiring no key at all
- **License-first ranking**: CC0 floats to the top; heuristic-only results stay below 0.5 confidence
- **Attribution always included**: one `attributionLine` string, ready for a tooltip or credits footer
- **Free tier needs no API key** for Wikimedia and Openverse; full provider coverage adds optional keys per provider

---

## Install

### One-line (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh | bash
```

Installs bun if missing, builds the server, symlinks `webfetch` onto `$PATH`, and merges the MCP block into `~/.claude/settings.json`.

### Claude Desktop / Claude Code

Add to `~/.claude/settings.json`:

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

### Cursor

Add to `~/.cursor/mcp.json`:

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

### Cline

Paste into Cline's MCP settings JSON (VSCode sidebar → Cline → MCP Servers):

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "bun",
      "args": ["run", "/path/to/webfetch/packages/mcp/src/index.ts"],
      "disabled": false,
      "autoApprove": ["search_images", "search_artist_images", "search_album_cover", "probe_page"]
    }
  }
}
```

Replace `/path/to/webfetch` with your clone path (default after installer: `~/.webfetch/repo`).

---

## Tools

| Tool | Description | Key params |
|------|-------------|------------|
| `search_images` | Federated search across 24 providers. Returns ranked candidates with license + attribution. Does not download. | `query`, `providers[]`, `licensePolicy`, `minWidth`, `minHeight` |
| `search_artist_images` | Specialized artist image search with kind-aware provider routing: `portrait`, `album`, `logo`, `performing`. | `artist`, `kind`, `providers[]` |
| `search_album_cover` | Canonical album artwork via MusicBrainz CAA + iTunes + Spotify. Results are `EDITORIAL_LICENSED`. | `artist`, `album` |
| `download_image` | Download a URL to local disk cache. 20 MB cap, content-type guard, SHA-256 hash, host blocklist enforced. | `url`, `maxBytes`, `cacheDir` |
| `fetch_with_license` | Resolve license for any URL via host heuristics + page metadata (`<link rel=license>`, `dc.rights`, OG tags). | `url`, `probe` (also download bytes) |
| `find_similar` | Reverse-image-search a reference URL. Requires `SERPAPI_KEY`. Returns leads — verify before shipping. | `url`, `providers[]` |
| `probe_page` | Enumerate every `<img>` on a webpage with inferred dimensions and per-image heuristic license. Respects `robots.txt`. | `url`, `respectRobots` |

### License tags

Results carry one of: `CC0` · `PUBLIC_DOMAIN` · `CC_BY` · `CC_BY_SA` · `EDITORIAL_LICENSED` · `PRESS_KIT_ALLOWLIST` · `UNKNOWN` (rejected). Rank order matches that list — lower is safer.

---

## Auth / env vars

| Provider | Env var | Free tier? |
|----------|---------|------------|
| Wikimedia Commons | — | Yes (no key) |
| Openverse | — | Yes (no key) |
| Unsplash | `UNSPLASH_ACCESS_KEY` | Demo key rate-limited |
| Pexels | `PEXELS_API_KEY` | Free tier available |
| Pixabay | `PIXABAY_API_KEY` | Free tier available |
| Spotify | `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` | Dev app required |
| Brave Search | `BRAVE_API_KEY` | Free tier available |
| SerpApi | `SERPAPI_KEY` | Required for `find_similar` |

MusicBrainz CAA and iTunes require no key. Missing keys cause the provider to skip gracefully — other providers still respond.

---

## Demo prompts

Try these in Claude Code or Cursor after installing:

```
Find me a CC-licensed portrait of Miles Davis I can use on an album liner page.
```

```
Search for album artwork for "Kind of Blue" by Miles Davis and show me the attribution line.
```

```
Probe the page at https://commons.wikimedia.org/wiki/File:Miles_Davis.jpg and tell me if I can use it commercially.
```

---

## Requirements

- **Node ≥ 18** or **Bun ≥ 1.0**
- No API key required for basic use (Wikimedia + Openverse cover most editorial needs)

---

## Links

- Landing site + docs: [getwebfetch.com](https://getwebfetch.com)
- One-line install guide: [docs/QUICKSTART.md](../../docs/QUICKSTART.md)
- Provider coverage matrix: [docs/PROVIDERS.md](../../docs/PROVIDERS.md)
- License policy details: [docs/LICENSE_POLICY.md](../../docs/LICENSE_POLICY.md)
- Per-agent install guides: [Claude Code](../../docs/INSTALL_CLAUDE_CODE.md) · [Cursor](../../docs/INSTALL_CURSOR.md) · [Cline](../../docs/INSTALL_CLINE.md)
- Issues: [github.com/ashlrai/webfetch/issues](https://github.com/ashlrai/webfetch/issues)
