# webfetch

Terminal CLI for license-aware federated image search, backed by
[`webfetch-core`](../core). One-shot version of the MCP server in
[`getwebfetch-mcp`](../mcp).

Use this when you want a human-in-the-loop result from a terminal. Use the MCP
server when you want a coding agent to call image search as a tool.

## Install

```bash
# when published
npm install -g getwebfetch

# local dev (monorepo root)
bun install
bun link --cwd packages/cli
```

Bun-native dev mode (no build step):

```bash
bun run packages/cli/src/index.ts search "drake portrait"
```

## Quick start

```bash
# federated search across the safe default provider set
webfetch search "drake portrait" --limit 5

# artist-specialized search with provider + query tuning
webfetch artist "Taylor Swift" --kind portrait --min-width 1200

# download one of the results to disk
webfetch download https://upload.wikimedia.org/... --out ./portrait.jpg
```

## Commands

```
webfetch search <query>                    [--providers a,b] [--license open|safe|context|prefer|any]
                                           [--max-per-provider N] [--min-width W] [--min-height H]
                                           [--json] [--limit N] [--verbose] [--dry-run] [--cloud]
webfetch artist <name> --kind portrait|album|logo|performing  [common opts]
webfetch album <artist> <album>            [common opts]
webfetch download <url>                    [--out path] [--max-bytes N] [--json]
webfetch probe <url>                       [--json]
webfetch license <url>                     [--probe] [--json]
webfetch providers                         [--json]
webfetch batch [--file path]               [--download-best] [--concurrency N]
                                           [--json|--jsonl] [--continue-on-error] [--candidates N]
webfetch watch <query>                     [--interval 1h] [--once] [--webhook URL] [--json]
webfetch config <init|show|get|set>        [--profile name] [--force] [--json]
webfetch help
webfetch version
```

### Output modes

Default: colorized table. `--json` emits machine-readable output:
`ImageCandidate[]` for search commands, a full record for `download`/`license`.
`batch --jsonl` emits one stable record per input line with `index`, `query`,
`status`, candidate data, provider reports, and any download metadata.

Batch input accepts one query per line. A tab-separated provider override is
also supported:

```text
drake portrait
radiohead album	itunes,musicbrainz-caa,spotify
# comments and blank lines are ignored
```

`webfetch batch --jsonl` emits records with this schema:

```ts
type BatchRecord =
  | {
      index: number;
      query: string;
      status: "ok";
      candidateCount: number;
      candidates: ImageCandidate[];
      top: ImageCandidate | null;
      downloads: Array<{ url: string; path: string; sha256: string; sidecar?: string }>;
      downloadedPath?: string;
      providerReports: ProviderReport[];
      warnings: string[];
    }
  | {
      index: number;
      query: string;
      status: "error";
      error: string;
      candidateCount: 0;
      candidates: [];
      top: null;
      downloads: [];
    };
```

Without `--continue-on-error`, the first failed query aborts the batch. With it,
failed records are emitted and the final exit code is `1` if any record failed.

### Local vs cloud

By default the CLI calls `webfetch-core` locally and uses provider API keys
from your environment. Pass `--cloud` or set `WEBFETCH_MODE=cloud` to call the
hosted API at `WEBFETCH_BASE_URL` or `baseUrl` from `~/.webfetchrc` (default:
`https://api.getwebfetch.com`). Cloud mode requires `WEBFETCH_API_KEY` or:

```bash
webfetch config set apiKey wf_live_...
```

Local mode can still use provider credentials such as `UNSPLASH_ACCESS_KEY`,
`PEXELS_API_KEY`, `PIXABAY_API_KEY`, and `BRIGHTDATA_API_TOKEN` from the
environment. Cloud mode sends requests to `/v1/search`, `/v1/artist`,
`/v1/album`, `/v1/download`, `/v1/probe`, `/v1/license`, and `/v1/providers`.

### Exit codes

- `0` success (including "no results found" — print friendly message)
- `1` unrecoverable error (network, bad config, etc.)
- `2` usage error (missing required argument, invalid flag value)

## Provider auth

Every provider gracefully skips when its auth is missing. Run
`webfetch providers` to see current status.

| Provider          | Env var(s)                                     | Default | Opt-in |
| ----------------- | ---------------------------------------------- | ------- | ------ |
| wikimedia         | -                                              | yes     | no     |
| openverse         | -                                              | yes     | no     |
| itunes            | -                                              | yes     | no     |
| musicbrainz-caa   | -                                              | yes     | no     |
| unsplash          | `UNSPLASH_ACCESS_KEY`                          | yes     | no     |
| pexels            | `PEXELS_API_KEY`                               | yes     | no     |
| pixabay           | `PIXABAY_API_KEY`                              | yes     | no     |
| spotify           | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`   | yes     | no     |
| brave             | `BRAVE_API_KEY`                                | yes     | no     |
| youtube-thumb     | -                                              | no      | yes    |
| bing              | `BING_API_KEY`                                 | no      | yes    |
| serpapi           | `SERPAPI_KEY`                                  | no      | yes    |
| browser           | -                                              | no      | yes    |
| managed-browser   | `BRIGHTDATA_API_TOKEN`                         | no      | yes    |
| flickr            | `FLICKR_API_KEY`                               | yes     | no     |
| internet-archive  | -                                              | yes     | no     |
| smithsonian       | `SMITHSONIAN_API_KEY`                          | yes     | no     |
| nasa              | -                                              | yes     | no     |
| met-museum        | -                                              | yes     | no     |
| europeana         | `EUROPEANA_API_KEY`                            | yes     | no     |
| library-of-congress | -                                            | yes     | no     |
| wellcome-collection | -                                            | yes     | no     |
| rawpixel          | `RAWPIXEL_API_KEY`                             | yes     | no     |
| burst             | -                                              | yes     | no     |
| europeana-archival | `EUROPEANA_API_KEY`                          | no      | yes    |

Other env vars:

- `WEBFETCH_USER_AGENT` — overrides the default UA string (Wikimedia and
  MusicBrainz require contact info per their ToS).
- `WEBFETCH_BLOCKLIST` — comma-separated hosts to reject during download.
- `NO_COLOR` / `FORCE_COLOR` — ANSI color toggles.
- `WEBFETCH_DEBUG` — print stack traces on unhandled errors.
- `WEBFETCH_API_KEY`, `WEBFETCH_BASE_URL`, `WEBFETCH_MODE=cloud` — hosted API mode.

## License Migration

Older CLI output may have shown Unsplash, Pexels, or Pixabay stock images as
`CC0`. Current output uses `UNSPLASH_LICENSE`, `PEXELS_LICENSE`, and
`PIXABAY_LICENSE`. Scripts that filtered on `license === "CC0"` should either
switch to `--license open` for Creative Commons/public-domain only, or include
the platform tags explicitly when those terms are acceptable.

## CLI vs MCP server

| Need                                              | Use          |
| ------------------------------------------------- | ------------ |
| One-shot terminal result, shell script, cron      | CLI          |
| Agent (Claude Code, Cursor, Cline) calls it       | MCP server   |
| Piping JSON into another tool                     | CLI `--json` / `batch --jsonl` |
| Interactive chat agent picking images mid-session | MCP server   |

Under the hood both wrap `webfetch-core`. Cache at `~/.webfetch/cache/` is
shared — the same image fetched by the CLI and the MCP server collapses by
content hash.

## Safety defaults

- `licensePolicy: "safe-only"` — open, platform-license, and editorial/press categories allowed; `UNKNOWN` rejected.
- 20 MB per-download cap, content-type guard, host blocklist.
- `youtube-thumb`, `bing`, `serpapi`, `browser`, `managed-browser`, and `europeana-archival`
  providers are opt-in; enable with `--providers`.
- `robots.txt` respected on generic page probes.

## Development

```bash
# from the repo root
bun install
bun test                           # run all tests
bun run --cwd packages/cli build   # emit dist/index.js
bun packages/cli/src/index.ts providers
```
