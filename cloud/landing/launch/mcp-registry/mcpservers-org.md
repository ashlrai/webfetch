# mcpservers.org submission — @webfetch/mcp

Target registry: https://mcpservers.org (community-curated, PR-based at
`modelcontextprotocol/servers` or the mirror list).

## Submission payload

```yaml
name: webfetch
package: "@webfetch/mcp"
homepage: https://getwebfetch.com
repository: https://github.com/ashlrai/webfetch
license: MIT
category: [search, media, content]
description: >
  License-first federated image search for AI agents. 24 providers
  (Wikimedia, Openverse, NASA, Smithsonian, Met Museum, LOC, Europeana,
  Unsplash, Pexels, Pixabay, Flickr-CC, Spotify, YouTube, iTunes,
  MusicBrainz-CAA, Brave, Bing, SerpAPI, and more) ranked license-first.
  UNKNOWN license is rejected by default. Every result ships with an
  attribution string.
install:
  claude_code: |
    claude mcp add webfetch -- npx -y @webfetch/mcp
  cursor_json: |
    { "webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] } }
env:
  - name: WEBFETCH_API_KEY
    required: false
    description: Pro/Team API key for pooled provider access + managed browser.
  - name: UNSPLASH_ACCESS_KEY
    required: false
    description: Optional — bring your own Unsplash key.
  - name: BRAVE_SEARCH_API_KEY
    required: false
  - name: SERPAPI_KEY
    required: false
tools:
  - name: search_images
    description: Federated license-aware image search across 24 providers.
  - name: download_image
    description: Content-addressed download with SHA-256 + EXIF/IPTC license extraction.
  - name: list_providers
    description: Enumerate available providers and their health status.
  - name: get_attribution
    description: Build a render-ready attribution string for any result.
tags:
  - images
  - search
  - license
  - creative-commons
  - mcp
  - federated
  - attribution
```

## PR template

- **Title:** `Add webfetch — license-first image search (24 providers)`
- **Body:** paste the YAML above + the one-paragraph description + 1
  screenshot from `/Users/masonwyatt/Desktop/web-fetcher-mcp/cloud/landing/public/gallery/`.
- **Checklist before PR:**
  - [ ] `@webfetch/mcp@0.1.0` published to npm
  - [ ] `npx -y @webfetch/mcp` returns a valid `tools/list` response
  - [ ] README has "How it works" + "Tools exposed" sections
  - [ ] MIT LICENSE present at package root

## Post-merge

- Tweet the listing link.
- Add the mcpservers.org badge to the repo README.
