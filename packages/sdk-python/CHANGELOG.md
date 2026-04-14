# Changelog

All notable changes to the `webfetch` Python SDK.

## [0.1.0] - 2026-04-13

Initial release.

- `WebfetchClient` and `AsyncWebfetchClient` backed by httpx.
- Full method parity with `@webfetch/core` public API: `search`,
  `search_artist_images`, `search_album_cover`, `download`, `probe`,
  `fetch_with_license`, `find_similar`, `providers`, plus cloud-only
  `usage` and `keys`.
- Pydantic v2 models mirroring the TypeScript type surface
  (`ImageCandidate`, `License`, `SearchResponse`, ...).
- Typed error hierarchy: `WebfetchError`, `AuthError`, `QuotaError`
  (with `upgrade_url`), `RateLimitError` (with `retry_after`).
- `python -m webfetch` CLI with `search`, `providers`, `download`.
- PEP 561 `py.typed` marker.
