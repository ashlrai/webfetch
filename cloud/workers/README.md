# @webfetch/cloud-workers

Cloudflare Workers backend powering `api.webfetch.dev`.

- **Runtime**: Cloudflare Workers with `nodejs_compat`.
- **Router**: [Hono](https://hono.dev).
- **Auth**: [Better Auth](https://better-auth.com) for the dashboard; `wf_live_*` bearer tokens for the API.
- **Storage**: D1 (SQL), KV (hot key lookup + rate limit + quota counters), R2 (cached blobs).
- **Async**: Cloudflare Queue (`webfetch-usage`) for metering writes.
- **Billing**: Stripe Checkout + Customer Portal + signed webhook.

Owns the pricing / metering / quota / team surface described in
`~/.claude/plans/wise-nibbling-karp.md` Wave B.

## Local development

```bash
# From repo root
bun install

# Create the local D1 (first time) and apply migrations
bun run --cwd cloud/workers migrate:local

# Boot the worker
bun run --cwd cloud/workers dev
# → http://localhost:8787
```

## Typecheck + tests

```bash
bun run --cwd cloud/workers typecheck
bun run --cwd cloud/workers test
```

The test suite uses a pure in-memory harness (`tests/harness.ts`) wrapping
`bun:sqlite` so it runs without Wrangler. That keeps tests fast (~1s) and
avoids needing a Cloudflare account to run CI.

## Deploying (Mason runs this)

```bash
# One-time: create D1, KV namespaces, R2 bucket, Queue
wrangler d1 create webfetch
wrangler kv:namespace create KEYS
wrangler kv:namespace create RATELIMIT
wrangler kv:namespace create QUOTA
wrangler r2 bucket create webfetch-cache
wrangler queues create webfetch-usage
wrangler queues create webfetch-usage-dlq

# Copy the returned ids into wrangler.toml

# Secrets
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Migrate + deploy
bun run --cwd cloud/workers migrate:remote
bun run --cwd cloud/workers deploy
```

## HTTP surface

Unauthenticated:

| Method | Path              | Purpose                       |
| ------ | ----------------- | ----------------------------- |
| GET    | `/health`         | liveness probe                |
| GET    | `/providers`      | list of providers + endpoints |
| ALL    | `/auth/*`         | Better Auth handler           |
| POST   | `/stripe/webhook` | signed Stripe webhook         |

Bearer `wf_live_*` auth (`/v1/*` metered endpoints):

| Method | Path           | Wraps                        |
| ------ | -------------- | ---------------------------- |
| POST   | `/v1/search`   | `searchImages`               |
| POST   | `/v1/artist`   | `searchArtistImages`         |
| POST   | `/v1/album`    | `searchAlbumCover`           |
| POST   | `/v1/download` | `downloadImage` (→ R2 cache) |
| POST   | `/v1/probe`    | `probePage`                  |
| POST   | `/v1/license`  | `fetchWithLicense`           |
| POST   | `/v1/similar`  | `findSimilar`                |

Dashboard cookie auth (`/v1/keys`, `/v1/usage`, `/v1/workspaces/*`):

| Method | Path                                        | Purpose                             |
| ------ | ------------------------------------------- | ----------------------------------- |
| POST   | `/v1/keys?workspaceId=…`                    | create an API key                   |
| GET    | `/v1/keys?workspaceId=…`                    | list keys                           |
| DELETE | `/v1/keys/:id?workspaceId=…`                | revoke a key                        |
| GET    | `/v1/usage?workspaceId=…`                   | snapshot + recent rows              |
| GET    | `/v1/workspaces`                            | list my workspaces                  |
| POST   | `/v1/workspaces`                            | create                              |
| GET    | `/v1/workspaces/:id/members`                | list seats                          |
| POST   | `/v1/workspaces/:id/invite`                 | invite a seat                       |
| PATCH  | `/v1/workspaces/:id/members/:userId`        | update role                         |
| DELETE | `/v1/workspaces/:id/members/:userId`        | remove seat                         |
| POST   | `/v1/workspaces/:id/checkout`               | Stripe Checkout URL                 |
| POST   | `/v1/workspaces/:id/portal`                 | Stripe Customer Portal URL          |

## Stripe webhook events handled

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

## Follow-ups

- **Team invite email delivery.** `POST /v1/workspaces/:id/invite` stores the
  invitation row + returns the accept URL, but there's no email sender yet.
  Wire to Postmark / Resend in a separate cron worker.
- **SSO (SAML / OIDC) for Enterprise.** Better Auth has an SSO plugin; enable
  per-workspace once we have the first enterprise customer.
- **Audit log retention policy.** Today audit_log is append-forever. Need a
  cron to prune to the configured retention (90d default, 1y enterprise) and
  to export to R2 before deletion.
