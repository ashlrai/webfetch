# Changelog

All notable changes to `webfetch-core`.

## [Unreleased]

- Split stock-provider license handling into `UNSPLASH_LICENSE`,
  `PEXELS_LICENSE`, and `PIXABAY_LICENSE` instead of classifying those results
  as `CC0`.
- Documented license-policy migration guidance for callers that need strictly
  Creative Commons or public-domain results.
- Added the `managed-browser` provider to the public provider taxonomy as an
  opt-in fallback with `UNKNOWN`/heuristic licensing.

## [0.1.0] - 2026-04-13

- Initial public core package with provider federation, license ranking,
  attribution strings, download caching, probing, and reverse-image search.
