# webfetch

[![npm version](https://img.shields.io/npm/v/getwebfetch?color=0a7)](https://www.npmjs.com/package/getwebfetch)
[![CI](https://github.com/ashlrai/webfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/webfetch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2)](https://getwebfetch.com/discord)
[![GitHub stars](https://img.shields.io/github/stars/ashlrai/webfetch?style=social)](https://github.com/ashlrai/webfetch)

**The license-first image layer for AI agents and humans.**

One MCP server, one CLI, and one HTTP server that federate across 25 image
providers, rank results license-first, and reject `UNKNOWN` results by default.
Any agent that speaks MCP (Claude Code, Cursor, Cline,
Continue, Roo Code, Codex) wires up from one config line. Landing page,
pricing, and hosted usage live at **[getwebfetch.com](https://getwebfetch.com)**.

## Install

| Surface       | One-liner |
| ------------- | --------- |
| npm           | `npm i -g getwebfetch` |
| Homebrew      | `brew tap ashlrai/webfetch && brew install webfetch` |
| Docker        | `docker run --rm ghcr.io/ashlrai/webfetch cli help` |
| curl \| bash  | `curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh \| bash` |

The `curl | bash` installer also wires webfetch into Claude Code's
`~/.claude/settings.json` idempotently. Re-run any time to update.

## 30-second usage

CLI:

```bash
webfetch search "drake portrait" --limit 5
webfetch artist "Taylor Swift" --kind portrait --min-width 1200
webfetch download <url> --out ./portrait.jpg
printf "drake portrait\nradiohead album\n" | webfetch batch --jsonl --continue-on-error
```

MCP (from inside any MCP-speaking agent):

```
search_images({ query: "drake portrait", limit: 5 })
search_artist_images({ artist: "Taylor Swift", kind: "portrait" })
download_image({ url: "..." })
```

TypeScript library:

```ts
import { searchArtistImages, pickBest, downloadImage } from "webfetch-core";

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
| unsplash         | high-quality photography                 | `UNSPLASH_LICENSE`   | `UNSPLASH_ACCESS_KEY`        | no     |
| pexels           | stock photography                        | `PEXELS_LICENSE`     | `PEXELS_API_KEY`             | no     |
| pixabay          | stock photos + illustrations             | `PIXABAY_LICENSE`    | `PIXABAY_API_KEY`            | no     |
| itunes           | album covers, artist portraits           | EDITORIAL_LICENSED   | —                            | no     |
| musicbrainz-caa  | canonical album art                      | EDITORIAL_LICENSED   | —                            | no     |
| spotify          | artist + album images                    | EDITORIAL_LICENSED   | `SPOTIFY_CLIENT_ID/SECRET`   | no     |
| youtube-thumb    | video thumbnails                         | EDITORIAL_LICENSED   | —                            | yes    |
| brave            | general web image search                 | UNKNOWN (+heuristic) | `BRAVE_API_KEY`              | no     |
| bing             | general web image search                 | UNKNOWN (+heuristic) | `BING_API_KEY`               | yes    |
| serpapi          | Google Images + reverse lookup           | UNKNOWN (+heuristic) | `SERPAPI_KEY`                | yes    |
| browser          | headless fallback vs images.google.com   | UNKNOWN              | —                            | yes    |
| managed-browser  | Bright Data managed browser fallback     | UNKNOWN              | `BRIGHTDATA_API_TOKEN`       | yes    |
| flickr           | CC / public-domain photography           | CC_BY (metadata)     | `FLICKR_API_KEY`             | no     |
| internet-archive | public-domain / CC archive media         | PUBLIC_DOMAIN        | —                            | no     |
| smithsonian      | Open Access museum media                 | CC0                  | `SMITHSONIAN_API_KEY`        | no     |
| nasa             | NASA imagery                             | PUBLIC_DOMAIN        | —                            | no     |
| met-museum       | The Met Open Access                      | CC0                  | —                            | no     |
| europeana        | European cultural heritage               | CC_BY (metadata)     | `EUROPEANA_API_KEY`          | no     |
| library-of-congress | US historical archive                 | PUBLIC_DOMAIN        | —                            | no     |
| wellcome-collection | medical/historical imagery            | CC_BY (metadata)     | —                            | no     |
| rawpixel         | CC0 stock slice                          | CC0                  | `RAWPIXEL_API_KEY` optional  | no     |
| burst            | Shopify Burst stock photos               | CC0                  | —                            | no     |
| europeana-archival | Europeana text/manuscript records      | CC_BY (metadata)     | `EUROPEANA_API_KEY`          | yes    |

See [`docs/PROVIDERS.md`](./docs/PROVIDERS.md) for gotchas, rate limits, and
[`docs/PROVIDER_TUNING.md`](./docs/PROVIDER_TUNING.md) for per-use-case picks.

## Local and cloud modes

The CLI is local-first: by default `webfetch search`, `artist`, `album`,
`download`, `probe`, `license`, and `batch` call `webfetch-core` in-process
and use provider API keys from your environment. Pass `--cloud` or set
`WEBFETCH_MODE=cloud` to call `https://api.getwebfetch.com/v1/*` with
`WEBFETCH_API_KEY` or `webfetch config set apiKey wf_live_...`.

Use local mode when you want direct provider calls and a local cache. Use cloud
mode when you want hosted auth, pooled provider keys, managed browser fallback,
usage accounting, or team controls.

## Why license-first

The only outcome we reject by default is an image we can't justify. A
marginally-better photo under an unknown license is worthless to a pipeline
that needs to ship without human review. Relevance ties are easy to break;
provenance is not.

The ranker sorts by: **license tag -> metadata confidence -> resolution ->
provider priority**. `UNKNOWN` is rejected by default (Berne Convention:
most of the web is all-rights-reserved unless proven otherwise). See
[`docs/LICENSE_POLICY.md`](./docs/LICENSE_POLICY.md).

### Migration: CC0 stock providers

Older webfetch builds treated Unsplash, Pexels, and Pixabay as `CC0`. Current
builds expose their platform terms explicitly:

| Old tag | New tag | What to check |
| --- | --- | --- |
| `CC0` from Unsplash | `UNSPLASH_LICENSE` | Unsplash terms; not Creative Commons |
| `CC0` from Pexels | `PEXELS_LICENSE` | Pexels terms; not Creative Commons |
| `CC0` from Pixabay | `PIXABAY_LICENSE` | Pixabay terms; not Creative Commons |

Most callers should keep `licensePolicy: "safe-only"` because it still allows
open, platform, editorial, and press-kit categories while rejecting `UNKNOWN`.
Pipelines that require only Creative Commons or public-domain assets should use
`licensePolicy: "open-only"` and update type guards to handle the three
platform tags separately.

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
                             |  webfetch-core  |
                             |  (ranker, cache, |
                             |   license coerce)|
                             +---------+--------+
                                       |
          +----------------+-----------+-----------+----------------+
          |                |                       |                |
  +-------v------+  +------v-------+       +-------v------+  +------v-------+
  | webfetch     |  | webfetch-mcp |       | webfetch-    |  | browser      |
  | CLI          |  | (stdio)      |       | server (HTTP)|  | extensions   |
  +-------+------+  +------+-------+       +-------+------+  +------+-------+
          |                |                       |                |
          |                |                       |                |
          +----------------+-----------+-----------+----------------+
                                       |
                 +---------------------v---------------------+
                 |              provider adapters            |
                 |  wikimedia  openverse  unsplash  pexels    |
                 |  pixabay    itunes     mb-caa    spotify   |
                 |  youtube    brave      bing      serpapi   |
                 |  flickr     nasa       met       europeana |
                 |  loc        wellcome   rawpixel  burst     |
                 |  browser + managed-browser + archival opt-in|
                 +-------------------------------------------+
```

Every surface shares `~/.webfetch/cache/` keyed by SHA-256, so a download
from the CLI is instantly available to the MCP server and vice versa.

## Safety defaults

- `licensePolicy: "safe-only"` — open, platform-license, and editorial/press categories are allowed; `UNKNOWN` is rejected.
- `safeSearch: "strict"`.
- Opt-in providers (`youtube-thumb`, `bing`, `serpapi`, `browser`, `managed-browser`, `europeana-archival`) off by default.
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
