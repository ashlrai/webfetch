# License Policy

## Ranking (lower = preferred)

| # | Tag                   | Meaning                                                 |
|---|-----------------------|---------------------------------------------------------|
| 1 | CC0                   | Public-domain dedication; no attribution needed         |
| 2 | PUBLIC_DOMAIN         | Expired copyright / gov work                            |
| 3 | CC_BY                 | Commercial OK, attribution required                     |
| 4 | CC_BY_SA              | Commercial OK, attribution + sharealike                 |
| 5 | UNSPLASH_LICENSE      | Unsplash platform license; not CC0                      |
| 6 | PEXELS_LICENSE        | Pexels platform license; not CC0                        |
| 7 | PIXABAY_LICENSE       | Pixabay platform license; not CC0                       |
| 8 | EDITORIAL_LICENSED    | Platform ToS allows editorial display (Spotify/CAA/iTunes) |
| 9 | PRESS_KIT_ALLOWLIST   | Official press kit from an allowlisted URL              |
|99 | UNKNOWN               | **REJECTED** by default                                 |

## Why license-first, not relevance-first

The only outcome we refuse is *shipping an image we can't justify*. A
marginally-better photo under an unknown license is worthless to a factory
that needs to ship without human review. Relevance ties are easy to break —
provenance is not. So the ranker sorts by license, then by confidence
(metadata > heuristic), then by resolution. When you want relevance-first,
you're usually in a speculative exploration flow — use `licensePolicy:
"prefer-safe"` to keep unsafe results but push them to the back.

## Why UNKNOWN is rejected

A missing license is not "probably fine". Most of the web is
all-rights-reserved by default under the Berne Convention. If we guessed
"safe" we'd ship infringing images. Better: we surface structured coverage
gaps so the caller can make an explicit call (e.g. pay for a press photo,
email the photographer, or drop the feature).

## Migration from CC0 stock tags

Unsplash, Pexels, and Pixabay are useful for commercial-friendly stock imagery,
but their terms are platform licenses, not Creative Commons or public-domain
dedications. Current webfetch releases therefore use dedicated tags:

| Provider | Old behavior | Current tag |
|---|---|---|
| Unsplash | `CC0` | `UNSPLASH_LICENSE` |
| Pexels | `CC0` | `PEXELS_LICENSE` |
| Pixabay | `CC0` | `PIXABAY_LICENSE` |

Migration checklist:

- Replace checks like `candidate.license === "CC0"` for these providers with
  explicit platform-license handling.
- Keep `licensePolicy: "safe-only"` if platform licenses are acceptable.
- Switch to `licensePolicy: "open-only"` when only `CC0`, `PUBLIC_DOMAIN`,
  `CC_BY`, or `CC_BY_SA` may pass.
- Re-render stored attribution or sidecar data for cached stock results so the
  persisted license tag matches the current taxonomy.

## Attribution

`buildAttribution()` produces a single human-readable string. Kept as a
string rather than structured markup so callers can render it inline in a
tooltip, a footer, or a dedicated credits page.

Example: `"Drake at OVO Fest 2019" by Jane Photog (Wikimedia Commons), licensed CC BY-SA 4.0 — https://commons.wikimedia.org/wiki/File:Drake_OVO_2019.jpg`

## Confidence score

Each candidate carries a `confidence` in [0, 1]:

- **0.95** — structured license metadata from an authoritative API (Wikimedia
  `extmetadata`, Openverse `license`)
- **0.85** — platform-owned license (Unsplash, Pexels, Pixabay)
- **0.6–0.8** — heuristics + coercion
- **≤ 0.4** — host-based guess only
- **0** — no evidence

Any candidate with `confidence < 0.5` should be re-verified before shipping
even if its tag is "safe".
