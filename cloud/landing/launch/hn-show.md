# Hacker News — Show HN

## Title (80 char max)
Show HN: webfetch — license-first image search for AI agents (MCP + CLI + 19 providers)

## Body

Hi HN — I'm Mason, founder of Ashlar AI. I'm launching webfetch, a federated, license-aware image fetching layer for AI agents and humans.

The short version: if you've ever had a Claude Code / Cursor / Cline agent invent an "image URL" out of thin air, or watched it right-click-save from Google Images and hallucinate license data, webfetch is the primitive that fixes it. One MCP config line, or one `npm i -g @webfetch/cli`, and your agent gets a stable `search_images` tool that hits 19+ licensed sources in parallel, ranks results license-first (CC0 > PD > CC-BY > CC-BY-SA > editorial), rejects UNKNOWN by default, and emits attribution strings ready to ship.

What's in the box at launch:

- 4 npm packages (`@webfetch/core`, `mcp`, `cli`, `server`), MIT licensed
- 19 providers: Wikimedia, Openverse, Unsplash, Pexels, Pixabay, NASA, Smithsonian, Met, LOC, Europeana, Flickr-CC, iTunes, MusicBrainz-CAA, Spotify, YouTube, Brave, Bing, SerpAPI, and an opt-in browser fallback
- Chrome extension + VS Code extension + GitHub Action + Homebrew tap + Docker image
- 117 passing tests
- Native MCP integration for Claude Code, Cursor, Cline, Continue, Roo Code, Codex
- Real DCT perceptual hashing for dedupe; EXIF/IPTC/XMP license reading
- A license-first ranker that I'll argue (in the blog) is the only defensible default in 2026

The moat, honestly, is the "like a human" browser fallback. When public APIs miss — and they miss on musician portraits, Pinterest boards, obscure product shots — webfetch can opt-in to a managed browser that pulls from Google Images / Pinterest, tags the result UNKNOWN, and emits a sidecar JSON with source URL + consent timestamp. Outsourced legally to Bright Data's Scraping Browser at launch; self-hosted Rebrowser + Camoufox for enterprise.

Pricing: OSS unlimited on your machine, forever. Cloud is $19/mo Pro (10K fetches, managed browser, pooled keys), $79/mo Team (50K pooled, RBAC, audit), Enterprise custom.

Built this inside a separate project (an artist-encyclopedia factory) and realized three of my other projects kept stealing the package. Parallelized ~30 Claude Code agents against a single plan doc and shipped the monorepo + cloud + site in two weeks.

Try it:

```
curl -fsSL https://webfetch.dev/install.sh | bash
webfetch search "drake portrait" --limit 5
```

Or drop this into your Claude Code config:

```json
"webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }
```

Repo: https://github.com/ashlr-ai/web-fetcher-mcp
Site: https://webfetch.dev
Blog (3 launch posts): https://webfetch.dev/blog

Happy to answer anything — especially about the legal posture on browser fetching, which I think is the most interesting design question here.

## First comment (author)

A couple of things I'd love feedback on:

1. **The rejection rule.** UNKNOWN is rejected by default. You can turn it off, but you have to turn it off explicitly in code. Is that the right friction level, or too aggressive?

2. **MCP as a distribution channel.** We're betting hard that MCP becomes the primitive — register once, every agent works. The risk is that Claude Code / Cursor build image-fetching in directly. Mitigation: VS Code extension + Python SDK + organic content to diversify surfaces. Anyone seeing different signals here?

3. **Browser fetching as a service.** We outsource to Bright Data at launch specifically because their legal team has been litigated to a stalemate with Meta and LinkedIn. Self-hosted is the enterprise option. Curious whether the HN crowd would prefer the reverse (self-hosted default, managed as upgrade), or thinks our split is right.
