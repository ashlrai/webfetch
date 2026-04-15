# webfetch

[![npm version](https://img.shields.io/npm/v/%40webfetch%2Fcli?color=0a7)](https://www.npmjs.com/package/@webfetch/cli)
[![CI](https://github.com/ashlrai/webfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/webfetch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2)](https://getwebfetch.com/discord)
[![GitHub stars](https://img.shields.io/github/stars/ashlrai/webfetch?style=social)](https://github.com/ashlrai/webfetch)

**The license-first image layer for AI agents and humans.**

One MCP server, one CLI, and one HTTP server that federate across 12+ image
providers, rank results license-first, and refuse to return anything you
can't safely ship. Any agent that speaks MCP (Claude Code, Cursor, Cline,
Continue, Roo Code, Codex) wires up from one config line. Landing page,
pricing, and hosted usage live at **[getwebfetch.com](https://getwebfetch.com)**.

## Install

| Surface       | One-liner |
| ------------- | --------- |
| npm           | `npm i -g @webfetch/cli` |
| Homebrew      | `brew install ashlrai/webfetch/webfetch` |
| Docker        | `docker run --rm ghcr.io/ashlrai/webfetch cli --help` |
| curl \| bash  | `curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh \| bash` |

The `curl | bash` installer also wires webfetch into Claude Code's
`~/.claude/settings.json` idempotently. Re-run any time to update.

## 30-second usage

CLI:

```bash
webfetch search "drake portrait" --limit 5
webfetch artist "Taylor Swift" --kind portrait --min-width 1200
webfetch download <url> --out ./portrait.jpg
```

MCP (from inside any MCP-speaking agent):

```
search_images({ query: "drake portrait", limit: 5 })
search_artist_images({ name: "Taylor Swift", kind: "portrait" })
download_image({ url: "..." })
```

TypeScript library:

```ts
import { searchArtistImages, pickBest, downloadImage } from "@webfetch/core";

const { candidates } = await searchArtistImages("Drake", "portrait");
const best = pickBest(candidates, { minWidth: 1200 });
if (best) {
  const { cachedPath, sha256 } = await downloadImage(best.url);
  console.log(best.attributionLine, "->", cachedPath);
}
```

## What problem this solves

Manually sourcing an image has four failure modes:

1. **You don't know the license**, so you can't safely ship the result.
2. **You can't script it** — every new site means another afternoon.
3. **Google's Image Search API is retired**; scraping is brittle and ToS-grey.
4. **No shared cache** — you re-download the same file dozens of times.

webfetch fixes all four by federating across direct-source APIs that have
stable terms and structured license metadata, ranking candidates
license-first, and exposing the result as a single MCP tool.

## Providers

| Provider         | Covers                                   | License default      | Auth                         | Opt-in |
| ---------------- | ---------------------------------------- | -------------------- | ---------------------------- | ------ |
| wikimedia        | portraits, events, logos, history        | CC_BY_SA (metadata)  | —                            | no     |
| openverse        | any CC-licensed content                  | CC_BY (metadata)     | —                            | no     |
| unsplash         | high-quality photography                 | Unsplash (~CC0)      | `UNSPLASH_ACCESS_KEY`        | no     |
| pexels           | stock photography                        | Pexels (~CC0)        | `PEXELS_API_KEY`             | no     |
| pixabay          | stock photos + illustrations             | Pixabay (~CC0)       | `PIXABAY_API_KEY`            | no     |
| itunes           | album covers, artist portraits           | EDITORIAL_LICENSED   | —                            | no     |
| musicbrainz-caa  | canonical album art                      | EDITORIAL_LICENSED   | —                            | no     |
| spotify          | artist + album images                    | EDITORIAL_LICENSED   | `SPOTIFY_CLIENT_ID/SECRET`   | no     |
| youtube-thumb    | video thumbnails                         | EDITORIAL_LICENSED   | —                            | no     |
| brave            | general web image search                 | UNKNOWN (+heuristic) | `BRAVE_API_KEY`              | no     |
| bing             | general web image search                 | UNKNOWN (+heuristic) | `BING_API_KEY`               | yes    |
| serpapi          | Google Images + reverse lookup           | UNKNOWN (+heuristic) | `SERPAPI_KEY`                | yes    |
| browser          | headless fallback vs images.google.com   | UNKNOWN              | —                            | yes    |

See [`docs/PROVIDERS.md`](./docs/PROVIDERS.md) for gotchas, rate limits, and
[`docs/PROVIDER_TUNING.md`](./docs/PROVIDER_TUNING.md) for per-use-case picks.

## Why license-first

The only outcome we refuse is shipping an image we can't justify. A
marginally-better photo under an unknown license is worthless to a pipeline
that needs to ship without human review. Relevance ties are easy to break;
provenance is not.

The ranker sorts by: **license tag -> metadata confidence -> resolution ->
provider priority**. `UNKNOWN` is rejected by default (Berne Convention:
most of the web is all-rights-reserved unless proven otherwise). See
[`docs/LICENSE_POLICY.md`](./docs/LICENSE_POLICY.md).

## webfetch vs alternatives

| Capability                            | webfetch | Raw Google Images | Unsplash-only | Bing CSE |
| ------------------------------------- | -------- | ----------------- | ------------- | -------- |
| Scriptable via API                    | yes      | no (retired)      | yes           | yes      |
| License metadata per result           | yes      | no                | yes (one lic) | partial  |
| Covers editorial music art            | yes      | partial           | no            | partial  |
| Covers CC / public-domain             | yes      | no                | no            | no       |
| Safe-by-default (rejects UNKNOWN)     | yes      | n/a               | n/a           | no       |
| Shared content-addressed cache        | yes      | no                | no            | no       |
| Attribution line pre-built            | yes      | no                | no            | no       |
| One MCP config line across all IDEs   | yes      | no                | no            | no       |
| No per-query cost on defaults         | yes      | n/a               | yes           | no       |

## Architecture

```
                             +------------------+
                             |  @webfetch/core  |
                             |  (ranker, cache, |
                             |   license coerce)|
                             +---------+--------+
                                       |
          +----------------+-----------+-----------+----------------+
          |                |                       |                |
  +-------v------+  +------v-------+       +-------v------+  +------v-------+
  | @webfetch/   |  | @webfetch/   |       | @webfetch/   |  | chrome-      |
  | cli          |  | mcp (stdio)  |       | server (HTTP)|  | extension    |
  +-------+------+  +------+-------+       +-------+------+  +------+-------+
          |                |                       |                |
          |                |                       |                |
          +----------------+-----------+-----------+----------------+
                                       |
                 +---------------------v---------------------+
                 |              provider adapters            |
                 |  wikimedia  openverse  unsplash  pexels   |
                 |  pixabay    itunes     mb-caa    spotify  |
                 |  youtube    brave      bing      serpapi  |
                 |  browser (opt-in, playwright)             |
                 +-------------------------------------------+
```

Every surface shares `~/.webfetch/cache/` keyed by SHA-256, so a download
from the CLI is instantly available to the MCP server and vice versa.

## Safety defaults

- `licensePolicy: "safe-only"` — `UNKNOWN` results rejected.
- `safeSearch: "strict"`.
- Opt-in providers (`serpapi`, `bing`, `browser`) off by default.
- 20 MB per-download cap, content-type guard, host blocklist.
- `robots.txt` respected on generic page probes.

## Roadmap

- `webfetch watch` — daemon mode for repeated queries / incremental refresh.
- Bring-your-own-provider plugin API.
- Hosted tier at [getwebfetch.com](https://getwebfetch.com) — pooled provider keys, managed browser fallback, team usage dashboard.

## Contributing

Issues and PRs welcome. Run `bun install && bun test` to get started. See
[`docs/`](./docs/) for per-area reference docs.

## License

MIT.
