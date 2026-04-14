# Provider tuning

`DEFAULT_PROVIDERS` is optimized for "ship a safe image without human review"
across a broad set of queries. For specific use cases, a narrower list is
usually cheaper, faster, and higher-precision.

## Recipes

### Musicians (artist pages, album pages)

```
--providers spotify,musicbrainz-caa,itunes,wikimedia
```

Rationale: these four cover ~98% of releases with editorial-licensed or
CC-BY-SA media. `spotify` needs `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`.

### Editorial / journalism (portraits, events, landmarks)

```
--providers wikimedia,openverse,unsplash
```

Rationale: Wikimedia carries news events, portraits, and historical photos
with metadata-backed CC licensing. Openverse federates across 50+ GLAM
collections. Unsplash fills stylistic gaps.

### Stock photography (marketing, blog hero images)

```
--providers unsplash,pexels,pixabay
```

Rationale: CC0-equivalent platform licenses, no attribution required, high
consistency. Fastest pipeline of the three.

### Science / nature / reference

```
--providers wikimedia,openverse
```

Rationale: structured metadata, expert curation, diagrams + species photos.

### General web (last-resort coverage)

```
--providers wikimedia,openverse,brave --license prefer-safe
```

`prefer-safe` keeps unknown-license results in the output but pushes them
past the license-safe ones. Useful for exploration; never use for shipping.

### Reverse image lookup / "who is this"

```
--providers serpapi --license any
```

Requires `SERPAPI_KEY`. Most other providers don't support reverse lookup.

## Tuning `max-per-provider`

- `1` — maximum diversity, fastest.
- `3` (default) — good balance.
- `10+` — saturates: often the same photo re-appears from multiple CDNs.
  Prefer raising `--limit` and leaving `--max-per-provider` low.

## Tuning `--min-width` / `--min-height`

- Hero images: `--min-width 1600`.
- Thumbnails / list rows: `--min-width 400`.
- Album covers: `--min-width 600` (1:1 aspect enforced automatically by
  `search_album_cover`).

## When to enable opt-in providers

| Provider | Enable when…                                                     |
| -------- | ---------------------------------------------------------------- |
| bing     | Query is English-web-heavy and Brave coverage is thin.           |
| serpapi  | You need Google-quality recall and accept per-query cost.        |
| browser  | You explicitly accept ToS risk and have `playwright` installed.  |

Opt-in providers only run when the `providers:` list mentions them AND (for
`browser`) `WEBFETCH_ENABLE_BROWSER=1` is set.
