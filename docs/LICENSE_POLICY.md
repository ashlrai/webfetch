# License Policy

## Ranking (lower = preferred)

| # | Tag                   | Meaning                                                 |
|---|-----------------------|---------------------------------------------------------|
| 1 | CC0                   | Public-domain dedication; no attribution needed         |
| 2 | PUBLIC_DOMAIN         | Expired copyright / gov work                            |
| 3 | CC_BY                 | Commercial OK, attribution required                     |
| 4 | CC_BY_SA              | Commercial OK, attribution + sharealike                 |
| 5 | EDITORIAL_LICENSED    | Platform ToS allows editorial display (Spotify/CAA/iTunes) |
| 6 | PRESS_KIT_ALLOWLIST   | Official press kit from an allowlisted URL              |
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
