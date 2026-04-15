# webfetch Cloud — Dashboard

Next.js 16 app that powers `app.getwebfetch.com`. Paying users manage API keys,
usage, teams, billing, provider BYOK, and audit logs here.

## Dev

```bash
bun install
bun run --cwd cloud/dashboard dev
# → http://localhost:3200
```

Set `NEXT_PUBLIC_USE_FIXTURES=1` to render without a live `api.getwebfetch.com`.

## Env

```
NEXT_PUBLIC_API_URL=https://api.getwebfetch.com
NEXT_PUBLIC_STRIPE_KEY=pk_live_...
NEXT_PUBLIC_USE_FIXTURES=0
```

## Deploy

Targets Vercel. Set the env vars above in the project settings. Session cookie
must be scoped to `.getwebfetch.com` so the dashboard and API share auth.

## Routes

| Path              | What it shows                                          |
| ----------------- | ------------------------------------------------------ |
| `/`               | Overview — MRR, usage, quota %, recent chart, live SSE |
| `/keys`           | Create / revoke API keys, last-used column             |
| `/usage`          | Daily / per-endpoint / per-provider / cost charts      |
| `/team`           | Members table, invite form, seats vs plan              |
| `/billing`        | Plan, next invoice, Stripe Customer Portal link        |
| `/providers`      | BYOK provider keys + status + test                     |
| `/audit`          | Filterable audit log + CSV export                      |
| `/settings`       | Profile, password, 2FA, notifications                  |
| `/login` `/signup`| Better Auth flows                                      |
