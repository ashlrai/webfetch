# mcp.run submission — @webfetch/mcp

Target registry: https://mcp.run (Extism-backed MCP registry with hosted
wasm + npx runtimes).

## Submission payload

```yaml
slug: webfetch
name: webfetch
publisher: ashlrai
runtime: node
entry: "npx -y @webfetch/mcp"
license: MIT
homepage: https://getwebfetch.com
repository: https://github.com/ashlrai/webfetch
tagline: License-first federated image search for AI agents (24 providers)
description: |
  webfetch is a single MCP server that federates 24 licensed image
  providers — Wikimedia, Openverse, NASA, Smithsonian, Met Museum, LOC,
  Europeana, Unsplash, Pexels, Pixabay, Flickr-CC, Spotify, YouTube,
  iTunes, MusicBrainz-CAA, Brave, Bing, SerpAPI, and an opt-in managed
  browser fallback.

  Results are ranked license-first (CC0 > PD > CC-BY > CC-BY-SA >
  editorial), UNKNOWN is rejected by default, and every image ships
  with a ready-to-render attribution string.

tools:
  - search_images
  - download_image
  - list_providers
  - get_attribution
  - rate_provider
secrets:
  - WEBFETCH_API_KEY       # optional cloud key (pooled providers + browser)
  - UNSPLASH_ACCESS_KEY    # optional BYO keys below
  - PEXELS_API_KEY
  - PIXABAY_API_KEY
  - FLICKR_API_KEY
  - BRAVE_SEARCH_API_KEY
  - SERPAPI_KEY
  - SPOTIFY_CLIENT_ID
  - SPOTIFY_CLIENT_SECRET
categories: [search, media, ai-agents, content]
badges:
  - provenance: true
  - license: MIT
  - tests: 117 passing
```

## Submission checklist

- [ ] `@webfetch/mcp@0.1.0` live on npm
- [ ] `npx -y @webfetch/mcp` responds to `tools/list` in <5s cold
- [ ] README top section has a mcp.run install button
- [ ] File a registry issue at https://github.com/dylibso/mcp.run-registry
      (or the current canonical path) with the YAML above

## Post-merge

- Enable mcp.run's hosted runner if available (saves users from
  installing Node).
- Paste the mcp.run install URL into the landing `install-tabs`
  component next to Claude Code + Cursor + Cline.
- Announce in the mcp.run Discord #new-servers channel with a link to
  `getwebfetch.com/blog/shipping-webfetch`.
