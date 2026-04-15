# Hacker News — Show HN

## Title (80 char max)

Show HN: Webfetch – license-first image search for AI agents (MCP, 24 providers)

<!-- 79 chars. Alternates if the above reads wrong after a sleep:
  - Show HN: Webfetch – one MCP for 24 licensed image sources (75 chars)
  - Show HN: Webfetch – license-aware image fetcher for agents (60 chars)
-->

## Body (under 750 chars)

I'm Mason. I kept watching Claude Code / Cursor agents invent image URLs and hallucinate license metadata, so I built webfetch: one MCP + CLI that fans out across 24 licensed providers (Wikimedia, Openverse, NASA, Smithsonian, Met, LOC, Europeana, Unsplash, Pexels, Flickr-CC, Spotify, YouTube, Brave, Bing, SerpAPI, +9), ranks license-first (CC0 > PD > CC-BY > CC-BY-SA > editorial), rejects UNKNOWN by default, and returns a render-ready attribution string.

Add to any agent with one config line: `"webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }`.

Apache-2.0 core. 117 passing tests. Opt-in managed browser for when public APIs miss.

Repo: https://github.com/ashlrai/webfetch
Site: https://getwebfetch.com

## First comment (author)

Three things I'd love feedback on:

1. **The rejection rule.** UNKNOWN is rejected by default — you can turn it off but only explicitly, in code. Right friction level, or too aggressive?

2. **MCP as distribution.** Betting hard that MCP becomes the primitive: register once, every agent works. The risk is Claude Code / Cursor building image-fetching in directly. Mitigating with VS Code ext, Python SDK, and organic content. Anyone seeing different signals?

3. **Browser fetching as a service.** We outsource to Bright Data's Scraping Browser at launch because their legal team has been litigated to a stalemate with Meta + LinkedIn. Self-hosted Rebrowser + Camoufox is the enterprise option. Is managed-default / self-host-upgrade the right split, or would you flip it?

Happy to dig into the license-first ranker, the 24-provider failover topology, EXIF/IPTC/XMP license extraction, the DCT perceptual-hash dedupe, or the pricing.

## Pre-submit checklist

- [ ] Repo public, README above the fold
- [ ] `getwebfetch.com` returns 200 and the install script hash matches the docs
- [ ] `npx -y @webfetch/mcp` returns a valid `tools/list` in <5s
- [ ] Author account has karma > 100 (required for Show HN)
- [ ] Submit between 06:00–08:00 PT on a Tuesday or Wednesday
- [ ] First comment posted within 60 seconds of submission
