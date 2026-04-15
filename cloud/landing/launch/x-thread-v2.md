# X thread v2 — soft launch

Personal, specific, no hype. Copy-paste ready. Every tweet is standalone-readable.

---

## Tweet 1 — Hook (225 chars)
Attach: `hero.png` (CLI returning a ranked result list with license tags visible)

I've been hand-sourcing licensed images for @yeuniverse and @theswiftyverse for weeks. Every image: 10 mins of Google → attribution check → save-with-sidecar.

Built webfetch to do it in one line.

Live today: getwebfetch.com

---

## Tweet 2 — What it does (241 chars)
Attach: `provider-matrix.png` (the 24-provider grid from /docs/providers)

One CLI + HTTP API + MCP that federates 24 licensed image sources — Wikimedia, Openverse, The Met, NASA, LOC, Unsplash, Spotify, and 17 more.

Every result ships with a license tag, a confidence score, and a ready-to-render attribution line.

---

## Tweet 3 — The moat (268 chars)
No image.

What makes it not-just-another-scraper:

1. License-first ranker. `UNKNOWN` is rejected by default.
2. 24 federated providers, each a try/catch so one outage never cascades.
3. Consent-gated "like a human" browser fallback — flagged UNKNOWN, never shipped by accident.

---

## Tweet 4 — Real use (223 chars)
Attach: `claude-demo.png` (Claude Code calling the webfetch MCP inline in a chat)

I use it daily. AshlrAI's artist encyclopedia pipeline pulls portraits, album art, and press kits through webfetch with `licensePolicy: safe-only`. What used to take a morning per artist now runs as one batch job overnight.

---

## Tweet 5 — Stack (247 chars)
No image.

Built in ~2 weeks on:
- Claude Code + ~30 parallel agents against one plan doc
- Cloudflare Workers + D1 for the API
- Vercel + Next.js for the docs
- MCP for the agent surface
- Playwright for the browser tier

117 passing tests. Apache 2.0 core.

---

## Tweet 6 — CTA (242 chars)
No image.

Try it free:

- Docs + signup: getwebfetch.com
- Free tier: 1,000 fetches/mo, no card
- Repo: github.com/ashlrai/webfetch
- MCP: one config line for Claude Code / Cursor / Cline / Continue / Roo / Codex

Feedback welcome — reply or DM.

---

## Tweet 7 (optional) — What's next (213 chars)
No image.

Next up:
- Python SDK (shipping this week)
- Bulk batch mode with checkpointing
- More reverse-image providers
- Helm chart for self-host

If you're building an AI agent that touches images, this saves you a week.

---

## Quiet-launch alternative (one tweet, 231 chars)

Shipped webfetch: one CLI + MCP that federates 24 licensed image sources (Wikimedia, NASA, Unsplash, Spotify, The Met…) with license-first ranking and ready-to-render attribution. Free tier live at getwebfetch.com. Apache 2.0 core.
