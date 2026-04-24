# Provider Coverage Matrix

| Provider         | Kinds covered                           | Default license      | Auth                                   | Rate limit (conservative) | Opt-in |
|------------------|-----------------------------------------|----------------------|----------------------------------------|---------------------------|--------|
| wikimedia        | portraits, events, logos, history       | CC_BY_SA (from meta) | none (UA required)                     | 20/s                      | no     |
| openverse        | any CC-licensed content                 | CC_BY (from meta)    | none                                   | 5/s                       | no     |
| unsplash         | high-quality photography                | CC0 (Unsplash Lic.)  | UNSPLASH_ACCESS_KEY                    | 1/s (demo-key budget)     | no     |
| pexels           | stock photography                       | CC0 (Pexels Lic.)    | PEXELS_API_KEY                         | 3/s                       | no     |
| pixabay          | stock photos, illustrations             | CC0 (Pixabay Lic.)   | PIXABAY_API_KEY                        | 2/s                       | no     |
| itunes           | album covers, artist portraits          | EDITORIAL_LICENSED   | none                                   | 5/s                       | no     |
| musicbrainz-caa  | canonical album art                     | EDITORIAL_LICENSED   | none (UA required)                     | 1/s (hard MB limit)       | no     |
| spotify          | artist + album images                   | EDITORIAL_LICENSED   | SPOTIFY_CLIENT_ID/SECRET               | 10/s                      | no     |
| youtube-thumb    | video thumbnail given id/URL            | EDITORIAL_LICENSED   | none                                   | 20/s                      | **yes** (narrow-source provider) |
| brave            | general web image search                | UNKNOWN (+heuristic) | BRAVE_API_KEY                          | 1/s                       | no     |
| bing             | general web image search                | UNKNOWN (+heuristic) | BING_API_KEY                           | 3/s                       | **yes** (API deprecation risk) |
| serpapi          | Google Images wrapper, reverse-image    | UNKNOWN (+heuristic) | SERPAPI_KEY                            | 2/s                       | **yes** |
| browser          | headless fallback vs images.google.com  | UNKNOWN (+heuristic) | none (requires `playwright` installed) | 0.25/s                    | **yes** (ToS-grey) |
| flickr           | CC-licensed + PD photos                 | CC_BY (from meta)    | FLICKR_API_KEY (free; gracefully skips) | 3/s                       | no     |
| internet-archive | PD / CC images across IA mediatype      | PUBLIC_DOMAIN        | none                                    | 5/s                       | no     |
| smithsonian      | Open Access museum collection (all CC0) | CC0                  | SMITHSONIAN_API_KEY (defaults DEMO_KEY) | 1/s (DEMO_KEY budget)     | no     |
| nasa             | NASA imagery archive (all public domain)| PUBLIC_DOMAIN        | none                                    | 5/s                       | no     |
| met-museum       | The Met Open Access (CC0 PD objects)    | CC0                  | none                                    | 4/s                       | no     |
| europeana        | European cultural heritage (CC/PD)      | CC_BY (from meta)    | EUROPEANA_API_KEY (free; gracefully skips) | 5/s                    | no     |
| library-of-congress | US historical photos/film archive    | PUBLIC_DOMAIN        | none                                    | 10/s                      | no     |
| wellcome-collection | medical/historical imagery (CC + PDM) | CC_BY (from meta)   | none                                    | 5/s                       | no     |
| rawpixel         | CC0 slice of Rawpixel's free library    | CC0                  | none (RAWPIXEL_API_KEY optional)        | 3/s                       | no     |
| burst            | Shopify Burst — 100% CC0 stock photos   | CC0                  | none                                    | 3/s                       | no     |
| europeana-archival | Europeana TEXT records (editorial)    | CC_BY (from meta)    | EUROPEANA_API_KEY (same as `europeana`) | 5/s                       | **yes** (variant of `europeana`) |

## Gotchas

- **Wikimedia**: returns mixed licenses; coercion is 100% metadata-driven.
  We never default to "probably CC".
- **Openverse**: `license_type=commercial,modification` is set by default so
  results are commercial-safe. Results without metadata are skipped.
- **Unsplash/Pexels/Pixabay licenses**: technically *not* CC0 — they're
  custom licenses that track CC0 terms (free commercial use, no attribution
  required). We map to CC0 with confidence 0.85.
- **iTunes / MusicBrainz CAA / Spotify**: EDITORIAL_LICENSED means "OK as
  part of album/artist identification UI under platform ToS". Always display
  attribution.
- **Brave**: returns web images with no structured license; we upgrade via
  `heuristicLicenseFromUrl` (Unsplash host → CC0, Commons host → CC-BY-SA
  pending verification, etc).
- **Bing**: Microsoft retired the classic Bing Search API mid-2025. This
  adapter still targets v7. Callers may need to swap endpoints.
- **SerpAPI**: opt-in because it's a paid relay. Most valuable for
  `find_similar` (Google reverse image search).
- **browser**: only runs when `WEBFETCH_ENABLE_BROWSER=1` AND `"browser"` is
  in `providers`. Scraping images.google.com is brittle and ToS-grey. Every
  result returned via this provider is flagged `viaBrowserFallback: true` so
  downstream code can refuse to ship it.

### New public-domain / CC providers

- **Flickr** (`flickr`): Uses `flickr.photos.search` with
  `license=1,4,5,7,8,9,10` (only safe CC / PD / CC0 — excludes NC and ND).
  Gracefully skips with `missing-auth` when `FLICKR_API_KEY` is absent.
  Confidence 0.9 because Flickr's license mapping is authoritative.
- **Internet Archive** (`internet-archive`): Queries `advancedsearch.php`
  with `mediatype:image AND (licenseurl:*creativecommons* OR rights:*public domain*)`.
  License coerced from `licenseurl` regex. No auth.
- **Smithsonian** (`smithsonian`): Open Access collection is 100% CC0.
  Falls back to `DEMO_KEY` when no key is configured — good for dev, will
  hit a 30/hr rate limit under real load. Confidence 0.95.
- **NASA** (`nasa`): All NASA-authored imagery is public domain (US Government
  work). No auth, no tokens.
- **The Met** (`met-museum`): Two-step (search → object detail); filtered
  to `isPublicDomain: true`. CC0 with confidence 0.95.
- **Europeana** (`europeana`): `REUSABILITY=open` filter restricts to CC
  and PD. Gracefully skips when `EUROPEANA_API_KEY` is absent.
- **Library of Congress** (`library-of-congress`): Huge US PD archive, no
  auth. `rights` field is coerced conservatively — "no known restrictions"
  and explicit PD text map to `PUBLIC_DOMAIN`; anything else → `UNKNOWN`.
- **Wellcome Collection** (`wellcome-collection`): Medical/historical imagery.
  Per-item `license.id` drives mapping: `pdm` → PUBLIC_DOMAIN, `cc0` → CC0,
  `cc-by` → CC_BY. `cc-by-nc-nd` results are dropped (not commercially safe).
- **Rawpixel** (`rawpixel`): Query is pinned with `freecc0=1` so every result
  is CC0 by construction. `RAWPIXEL_API_KEY` optional today.
- **Burst** (`burst`): Shopify's free stock library — 100% CC0 by policy.
- **Europeana Archival** (`europeana-archival`): Opt-in variant of
  `europeana` that targets `TYPE:TEXT` records (manuscripts, newspapers,
  book scans) and surfaces their `edmPreview` thumbnails. Useful for
  editorial / historical layouts.

## Picking providers

- **Just want a safe image?** Use the defaults. `DEFAULT_PROVIDERS` excludes
  every ToS-grey source.
- **Building artist pages?** Use `searchArtistImages(name, kind)` — it picks
  the right sources per kind automatically.
- **Need *anything* at all, license be damned?** `providers: ["brave",
  "serpapi", "browser"]` with `licensePolicy: "any"`. Understand the risk.
