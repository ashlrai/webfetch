---
title: "Shipping webfetch: a license-first image layer for AI agents"
published: true
tags: ai, mcp, opensource, typescript
canonical_url: https://webfetch.dev/blog/shipping-webfetch
cover_image: https://webfetch.dev/og-image.svg
---

Today I'm shipping **webfetch** — a federated, license-aware image search layer for AI agents (and humans). One CLI, one MCP server, 19+ licensed providers, and a ranker that rejects anything with an unknown license by default.

Live at [webfetch.dev](https://webfetch.dev). Source: [github.com/ashlr-ai/web-fetcher-mcp](https://github.com/ashlr-ai/web-fetcher-mcp). MIT.

## The problem

Every AI agent I've ever used has one or more of these failure modes when it needs an image:

1. It hallucinates a URL that 404s.
2. It right-click-saves from Google Images and invents license metadata.
3. It gets stuck on "I can't verify the license" and gives up.
4. It downloads the same file over and over because it has no cache.

Human developers have the same four failure modes, just slower.

## The design

webfetch is one `search_images(query)` call that:

- fans out across 19 providers (Wikimedia, Openverse, Unsplash, Pexels, Pixabay, NASA, Smithsonian, Met Museum, LOC, Europeana, Flickr-CC, iTunes, MusicBrainz-CAA, Spotify, YouTube, Brave, Bing, SerpAPI, and an opt-in browser fallback)
- ranks results **license-first**: CC0 > PUBLIC_DOMAIN > CC_BY > CC_BY_SA > EDITORIAL_LICENSED > UNKNOWN
- rejects UNKNOWN by default (you can opt in explicitly, in code)
- returns a pre-built attribution string on every result
- content-addresses the download via SHA-256 so cached hits are free

One surface (MCP) means every agent works — Claude Code, Cursor, Cline, Continue, Roo Code, Codex. One surface (CLI) means every terminal works. One surface (HTTP server) means every language works.

## The code

```bash
npm i -g @webfetch/cli
webfetch search "drake portrait" --limit 5
```

Or as a library:

```ts
import { searchArtistImages, pickBest, downloadImage } from "@webfetch/core";

const { candidates } = await searchArtistImages("Drake", "portrait");
const best = pickBest(candidates, { minWidth: 1200 });
if (best) {
  const { cachedPath } = await downloadImage(best.url);
  console.log(best.attributionLine, "->", cachedPath);
}
```

Or as an MCP config one-liner in Claude Code / Cursor / Cline:

```json
"webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }
```

## The moat: "like a human" browser fallback

Public APIs miss things. Pinterest boards. Musician portraits. Obscure product shots. Google Images has no usable API.

webfetch has an opt-in browser fallback that:

- uses Bright Data's Scraping Browser for launch (outsources legal + captcha risk)
- tags every browser-sourced result `UNKNOWN`
- requires explicit consent per call
- emits a sidecar JSON with source URL + screenshot + timestamp

You stay in control of the compliance decision. Enterprise customers can run self-hosted Rebrowser-Playwright + Camoufox in their own tenant.

## The business model

OSS unlimited on your machine, forever. Cloud is $19/mo Pro (10K metered fetches + managed browser + pooled keys), $79/mo Team (50K + RBAC + audit log), Enterprise custom.

This is the same OSS/commercial split as phantom-secrets. It works because the thing that's hard to self-host (managed browser, pooled provider keys, audit log) is the thing you pay for. The thing that's easy to self-host (the CLI, the MCP server) is the thing you get for free, forever.

## Why I'm writing this

I parallelized ~30 Claude Code agents across a monorepo for two weeks. Shipped 4 npm packages + Chrome ext + VS Code ext + GitHub Action + Homebrew + Docker + cloud backend + landing site + 117 passing tests. If you've been curious what that workflow looks like in practice, the full writeup is on the blog: [webfetch.dev/blog/shipping-webfetch](https://webfetch.dev/blog/shipping-webfetch).

Feedback welcome. I'm around in the comments.

— Mason
