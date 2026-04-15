# SSO + Provider + Stripe Setup

Step-by-step runbook for wiring `api.getwebfetch.com` (the Cloudflare Worker in
`cloud/workers/`) to real Google/GitHub OAuth, pooled provider keys, Stripe
billing, and an optional Bright Data browser layer.

All `wrangler` commands run from `cloud/workers/`. Every secret is optional at
the infra layer — a missing key simply disables that provider/feature.

---

## Part A: Google OAuth (10 min)

1. Open `https://console.cloud.google.com` → select or create project `webfetch`.
2. **APIs & Services → OAuth consent screen** → External → fill the minimum:
   - App name: `webfetch`
   - User support email: you
   - Authorized domains: `getwebfetch.com`
3. **Credentials → Create Credentials → OAuth client ID → Web application**:
   - Name: `webfetch-production`
   - Authorized JavaScript origins: `https://app.getwebfetch.com`
   - Authorized redirect URIs: `https://api.getwebfetch.com/auth/callback/google`
4. Copy the **Client ID** and **Client Secret**.
5. Push both as Worker secrets:

   ```bash
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```

6. Deploy:

   ```bash
   wrangler deploy
   ```

---

## Part B: GitHub OAuth (5 min)

1. `https://github.com/settings/developers` → **OAuth Apps → New**.
2. Fill:
   - Application name: `webfetch`
   - Homepage URL: `https://getwebfetch.com`
   - Authorization callback URL: `https://api.getwebfetch.com/auth/callback/github`
3. Copy **Client ID**, click **Generate a new client secret**, copy it.
4. Push:

   ```bash
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   ```

---

## Part C: Provider API keys (30 min total; all free tiers)

Every provider below is optional. Sign up for the ones you care about; the rest
are automatically skipped with no error at runtime.

| Provider    | Signup URL                                           | Free tier            | Env var                                                     |
| ----------- | ---------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| Unsplash    | https://unsplash.com/developers                      | 5,000 req/hr         | `PLATFORM_UNSPLASH_ACCESS_KEY`                              |
| Pexels      | https://www.pexels.com/api/new/                      | 200 req/hr           | `PLATFORM_PEXELS_API_KEY`                                   |
| Pixabay     | https://pixabay.com/api/docs/                        | 100 req/min          | `PLATFORM_PIXABAY_API_KEY`                                  |
| Brave       | https://brave.com/search/api/                        | 2,000 req/mo         | `PLATFORM_BRAVE_API_KEY`                                    |
| SerpAPI     | https://serpapi.com/                                 | 100 searches/mo      | `PLATFORM_SERPAPI_KEY`                                      |
| Bing        | https://portal.azure.com (deprecated — optional)     | pay-as-you-go        | `PLATFORM_BING_API_KEY`                                     |
| Spotify     | https://developer.spotify.com/dashboard              | client-credentials   | `PLATFORM_SPOTIFY_CLIENT_ID` + `PLATFORM_SPOTIFY_CLIENT_SECRET` |
| Flickr      | https://www.flickr.com/services/apps/create/         | no limit (low vol)   | `PLATFORM_FLICKR_API_KEY`                                   |
| Smithsonian | https://api.data.gov/signup/                         | DEMO_KEY works       | `PLATFORM_SMITHSONIAN_API_KEY`                              |
| Europeana   | https://pro.europeana.eu/get-api                     | unlimited            | `PLATFORM_EUROPEANA_API_KEY`                                |

Push each as you receive it:

```bash
wrangler secret put PLATFORM_UNSPLASH_ACCESS_KEY
wrangler secret put PLATFORM_PEXELS_API_KEY
wrangler secret put PLATFORM_PIXABAY_API_KEY
wrangler secret put PLATFORM_BRAVE_API_KEY
wrangler secret put PLATFORM_SERPAPI_KEY
wrangler secret put PLATFORM_BING_API_KEY
wrangler secret put PLATFORM_SPOTIFY_CLIENT_ID
wrangler secret put PLATFORM_SPOTIFY_CLIENT_SECRET
wrangler secret put PLATFORM_FLICKR_API_KEY
wrangler secret put PLATFORM_SMITHSONIAN_API_KEY
wrangler secret put PLATFORM_EUROPEANA_API_KEY
```

Also set a contact email for polite User-Agent headers (Wikimedia /
MusicBrainz / Europeana require one):

```bash
wrangler secret put INGEST_CONTACT_EMAIL   # e.g. hello@ashlr.ai
```

Verify with `curl https://api.getwebfetch.com/providers` — the
`platformProvidersAvailable` array lists providers whose keys are live.

---

## Part D: Stripe products (15 min)

1. `https://dashboard.stripe.com/products` → **Create product** four times:
   - **webfetch Free** — $0/mo, 0 fetches metered
   - **webfetch Pro** — $19/mo, 10,000 fetches included, $0.015/overage
   - **webfetch Team** — $79/mo base + $12/seat, 50,000 fetches, $0.01/overage
   - **webfetch Enterprise** — custom price
2. Copy each product's `price_xxx` ID from the pricing tab.
3. Push each as a secret (names must match `cloud/shared/pricing.ts`):

   ```bash
   wrangler secret put STRIPE_PRICE_PRO
   wrangler secret put STRIPE_PRICE_TEAM
   wrangler secret put STRIPE_PRICE_TEAM_SEAT
   wrangler secret put STRIPE_PRICE_OVERAGE_PRO
   wrangler secret put STRIPE_PRICE_OVERAGE_TEAM
   ```

4. From **Developers → API keys**, copy your `sk_live_...` secret key; from
   **Developers → Webhooks**, create an endpoint pointed at
   `https://api.getwebfetch.com/stripe/webhook` and subscribe to
   `customer.subscription.*` + `invoice.payment_failed`. Copy the signing
   secret.

   ```bash
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

5. Redeploy:

   ```bash
   wrangler deploy
   ```

---

## Part E: Flip your workspace to Pro for dogfooding

After signing up at `https://app.getwebfetch.com/signup` with your email, run
the following against the remote D1 database (replace `YOUR_EMAIL`):

```bash
wrangler d1 execute webfetch-prod --remote --command "
UPDATE workspaces SET plan = 'pro', subscription_status = 'active'
WHERE id = (
  SELECT workspace_id FROM members
   WHERE user_id = (SELECT id FROM users WHERE email = 'YOUR_EMAIL')
   LIMIT 1
);"
```

Verify:

```bash
wrangler d1 execute webfetch-prod --remote --command "
SELECT w.id, w.plan, w.subscription_status FROM workspaces w
 JOIN members m ON m.workspace_id = w.id
 JOIN users u ON u.id = m.user_id
 WHERE u.email = 'YOUR_EMAIL';"
```

Your next `/v1/search` call will now receive the full pooled key set.

---

## Part F: Optional — Bright Data managed browser

For the "browse like a human" fallback on Google Images and Pinterest.

1. `https://brightdata.com` → sign up → **Scraping Browser** → generate
   credentials.
2. Push:

   ```bash
   wrangler secret put BRIGHTDATA_CUSTOMER
   wrangler secret put BRIGHTDATA_PASSWORD
   ```

3. Redeploy. Feature is automatically gated to Pro+ in the resolver.

---

## Notes

- Email verification is off by default when `RESEND_API_KEY` is still
  `test_stub`. Once you push a real Resend key, it flips back on automatically.
  Force-on anyway with `wrangler secret put REQUIRE_EMAIL_VERIFICATION` set to
  `1`.
- Every platform key is optional; the resolver in
  `cloud/workers/src/middleware/platform-keys.ts` enables each provider only
  when its env secret is present. Missing keys degrade gracefully.
- Free-tier users never see the pooled keys; the resolver only overlays them
  for `plan IN ('pro', 'team', 'enterprise')`.
