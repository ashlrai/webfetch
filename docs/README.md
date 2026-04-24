# webfetch docs

## Installation

- [QUICKSTART.md](./QUICKSTART.md) — the 30-second path + per-surface verification
- [INSTALL_CLAUDE_CODE.md](./INSTALL_CLAUDE_CODE.md) — Claude Code settings.json
- [INSTALL_CURSOR.md](./INSTALL_CURSOR.md) — Cursor `mcp.json`
- [INSTALL_CLINE.md](./INSTALL_CLINE.md) — Cline VS Code extension

## Reference

- [PROVIDERS.md](./PROVIDERS.md) — every provider's coverage, auth, rate limits
- [PROVIDER_TUNING.md](./PROVIDER_TUNING.md) — which providers to pick per use case
- [LICENSE_POLICY.md](./LICENSE_POLICY.md) — how licenses rank, why UNKNOWN is rejected
- [COST.md](./COST.md) — what each provider costs

## The "Google Images alternative" story

Manually Googling images and right-click-saving has four problems:

1. You don't know the license, so you can't safely ship the result.
2. You can't script it — every new site means another afternoon.
3. Google's own Image Search API is retired; scraping is brittle and ToS-grey.
4. No shared cache: you re-download the same image dozens of times.

This package fixes all four by federating across direct-source APIs that do
have stable terms and structured license metadata, ranking candidates
license-first, and exposing the result as an MCP tool every coding agent
can call in one line.
