# Changelog

All notable changes to the `webfetch` Python SDK.

## [Unreleased]

- Documented the license taxonomy migration from legacy `CC0` stock-provider
  handling to `UNSPLASH_LICENSE`, `PEXELS_LICENSE`, and `PIXABAY_LICENSE`.
- Clarified cloud default routing (`/v1/*`) versus local/self-hosted
  compatibility routes.
- Added CLI batch handoff guidance for JSONL-oriented workflows.

## [0.1.0] - 2026-04-13

Initial release.

- `WebfetchClient` and `AsyncWebfetchClient` backed by httpx.
- Full method parity with `webfetch-core` public API: `search`,
  `search_artist_images`, `search_album_cover`, `download`, `probe`,
  `fetch_with_license`, `find_similar`, `providers`, plus cloud-only
  `usage` and `keys`.
- Pydantic v2 models mirroring the TypeScript type surface
  (`ImageCandidate`, `License`, `SearchResponse`, ...).
- Typed error hierarchy: `WebfetchError`, `AuthError`, `QuotaError`
  (with `upgrade_url`), `RateLimitError` (with `retry_after`).
- `webfetch-py` / `python -m webfetch` CLI with `search`, `artist`, `album`,
  `providers`, `download`, `probe`, `license`, and `similar`.
- PEP 561 `py.typed` marker.
