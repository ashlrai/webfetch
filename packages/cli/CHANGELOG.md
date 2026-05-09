# Changelog

All notable changes to `webfetch`.

## [Unreleased]

- Added CLI-first documentation for `webfetch batch --jsonl`, including the
  input format and stable per-line output schema.
- Clarified local-first execution versus `--cloud` / `WEBFETCH_MODE=cloud`
  hosted API routing.
- Documented the migration from legacy `CC0` stock-provider output to
  `UNSPLASH_LICENSE`, `PEXELS_LICENSE`, and `PIXABAY_LICENSE`.

## [0.1.0] - 2026-04-13

- Initial public CLI with search, artist, album, download, probe, license,
  providers, batch, watch, and config commands.
