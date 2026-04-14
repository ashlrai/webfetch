# Cost

webfetch itself is free. Most providers are too. A few are metered.

| Provider         | Free tier                                   | Paid beyond                          | Notes                                   |
| ---------------- | ------------------------------------------- | ------------------------------------ | --------------------------------------- |
| wikimedia        | Free, rate-limited (UA required)            | —                                    | Donation-funded infra.                  |
| openverse        | Free                                        | —                                    | CC Search successor.                    |
| unsplash         | 50 req/hr demo, 5000 req/hr prod            | Free on approval                     | Requires `UNSPLASH_ACCESS_KEY`.         |
| pexels           | 200 req/hr, 20k/month                       | Free (higher quotas on request)      | Requires `PEXELS_API_KEY`.              |
| pixabay          | 100 req/60s                                 | Free                                 | Requires `PIXABAY_API_KEY`.             |
| itunes           | Free, soft rate limit                       | —                                    | Apple Search API.                       |
| musicbrainz-caa  | 1 req/s hard cap                            | —                                    | Donation-funded; UA with contact req'd. |
| spotify          | Free with OAuth client credentials          | —                                    | Needs `SPOTIFY_CLIENT_ID/SECRET`.       |
| youtube-thumb    | Free (static thumbnail URLs)                | —                                    | No API call; URL composition only.      |
| brave            | 2000 queries/month free                     | $3/1k queries (2024 pricing)         | Metered; watch usage.                   |
| bing             | Deprecated mid-2025                         | Contact Microsoft                    | Not recommended for new projects.       |
| serpapi          | 100 searches/month free                     | $50/mo = 5k searches (2024 pricing)  | Google Images proxy.                    |
| browser          | Free to run; high infra cost                | —                                    | Needs Playwright + headless Chromium.   |

## Cache

Every download lands in `~/.webfetch/cache/<sha256>.<ext>`. Re-fetches from
any provider that point at the same bytes are free (collapsed by content
hash). Cache has no TTL — delete manually if you want to re-download.

## Rough monthly cost by use case

- **Build-time enrichment for a 1k-page site (monthly rebuild)**
  with the default safe providers: ~$0.
- **Realtime agent, 50 queries/day, Brave fallback enabled**:
  ~$0–5/month (Brave free tier covers most).
- **High-volume Google Images replacement via SerpAPI**,
  1000 queries/day: ~$300/month on SerpAPI alone.

## Recommendation

Start with the default safe set (all free). Add `BRAVE_API_KEY` when you
notice coverage gaps. Only reach for SerpAPI when you have a revenue
justification — its cost dominates everything else combined.
