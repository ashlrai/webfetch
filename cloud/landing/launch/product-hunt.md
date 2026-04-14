# Product Hunt — webfetch

## Name
webfetch

## Tagline (60 char max)
License-first image search for AI agents. One MCP. 19 sources.

## Description (260 char)
webfetch is the license-aware image fetching layer your AI agent is missing. One CLI + MCP server federates 19+ providers (Wikimedia, Unsplash, NASA, Smithsonian, and more), ranks results license-first, and ships attribution on every image. MIT open-source.

## Gallery (order)
1. Hero screenshot — dark landing with install command
2. CLI demo GIF — `webfetch search "drake portrait"` returning 5 license-tagged candidates
3. MCP in Claude Code — agent calling `search_images` + shipping the result into a project
4. Provider matrix — the 19-row table
5. Pricing page — Free / Pro / Team / Enterprise
6. Architecture diagram — CLI/MCP/ext → core → providers + browser + cloud
7. Chrome extension — shadow-DOM sidebar with license-ranked results
8. Dashboard screenshot — usage + API keys + audit log

## First comment (maker)

Hey PH — Mason here, founder of Ashlar AI.

I built webfetch because every AI agent I'd ever used invented image URLs out of thin air or hallucinated license data. After shipping the 4th one-off image scraper inside a different project, I made a package. Three other projects stole it. That was the signal.

Two weeks later, it's a product:

- 4 npm packages (MIT), 19 federated providers, 117 passing tests
- Native MCP support for Claude Code / Cursor / Cline / Continue / Roo Code / Codex
- Chrome extension + VS Code extension + GitHub Action + Homebrew + Docker
- License-first ranker; UNKNOWN rejected by default
- Opt-in "like a human" browser fallback for when APIs miss (Google Images, Pinterest) with attribution sidecars

OSS is unlimited on your machine forever. Cloud is usage-based ($19/mo Pro, $79/mo Team, Enterprise custom).

If you've ever had a content team or an AI pipeline get blocked on "is this image safe to ship?" — webfetch is the protocol layer that unblocks it.

Feedback very welcome. I'm also around all day in the comments.

## Topics
Developer Tools, Artificial Intelligence, API, Open Source, Productivity

## Links
- Website: https://webfetch.dev
- GitHub: https://github.com/ashlr-ai/web-fetcher-mcp
- Docs: https://webfetch.dev/docs
- Pricing: https://webfetch.dev/pricing

## Maker comment — question for hunters
What's the one image-sourcing pain we haven't solved yet? We have a clear roadmap (Python SDK, reverse image search, bulk batch mode), but if you're hitting a wall we didn't anticipate, name it — first 10 responses get a free year of Pro.
