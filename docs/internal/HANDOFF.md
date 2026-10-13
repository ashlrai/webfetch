# webfetch — Handoff

Status: READY TO LAUNCH as of 2026-04-13. Domain: getwebfetch.com.

This is the do-this list. See LAUNCH.md for detailed runbook, per-step rollback, and troubleshooting.

## What you verify first (5 min)

- [ ] Sign into npm, confirm `@webfetch` scope is available (`npm access ls-packages` or attempt a dry-run publish)
- [ ] Register `getwebfetch.com` (Porkbun / Namecheap — roughly $30/yr on .sh)
- [ ] Create `github.com/ashlrai/webfetch` (empty public repo, no README / no license — we push ours)
- [ ] Create `github.com/ashlrai/homebrew-webfetch` (empty public repo — CI pushes the tap formula)

## Accounts you sign up for (15 min, all free tiers)

- Cloudflare — workers + D1 for `api.getwebfetch.com`
- Stripe — billing (live mode keys)
- SendGrid — team invite emails (authenticate `getwebfetch.com` sender domain)
- Vercel — hosts `app.getwebfetch.com` (dashboard) + `getwebfetch.com` (landing)
- PyPI — if you don't already have a publisher token
- VS Code Marketplace publisher (Azure DevOps PAT) — if not already

## Tokens you collect (30 min)

| Secret | Source | Scope |
| --- | --- | --- |
| `NPM_TOKEN` | npmjs.com → Access Tokens | Automation, publish |
| `GHCR_TOKEN` | github.com → PAT (classic) | `write:packages`, `read:packages` |
| `HOMEBREW_GH_TOKEN` | github.com → PAT | `repo` on `ashlrai/homebrew-webfetch` |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → API Tokens | Workers + D1 edit |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com | Live secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → add endpoint | Signing secret |
| `SENDGRID_API_KEY` | sendgrid.com → API Keys | Full access (Mail Send) |
| `VERCEL_TOKEN` | vercel.com → Tokens | Account-scoped |
| `VSCE_PAT` | dev.azure.com PAT | Marketplace (manage) |
| `PYPI_TOKEN` | pypi.org → API tokens | Project-scoped once created |

## The 10 commands (paste in order)

1. `cd ~/Desktop/web-fetcher-mcp`
2. `git remote add origin git@github.com:ashlrai/webfetch.git && git push -u origin main`
3. Set GitHub Actions secrets (8 required for CI):
   ```
   gh secret set NPM_TOKEN
   gh secret set GHCR_TOKEN
   gh secret set HOMEBREW_GH_TOKEN
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set STRIPE_SECRET_KEY
   gh secret set STRIPE_WEBHOOK_SECRET
   gh secret set SENDGRID_API_KEY
   gh secret set VERCEL_TOKEN
   ```
4. `git tag v0.1.0 && git push --tags` — CI publishes npm packages + Docker image + Homebrew formula. Watch: `gh run watch`.
5. `wrangler login && wrangler d1 create webfetch-prod` — copy the `database_id` into `cloud/workers/wrangler.toml` (`[[d1_databases]]` block).
6. Deploy workers:
   ```
   cd cloud/workers
   wrangler d1 migrations apply webfetch-prod --remote
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put STRIPE_WEBHOOK_SECRET
   wrangler secret put SENDGRID_API_KEY
   wrangler deploy
   ```
   Point `api.getwebfetch.com` at the worker (Cloudflare → Workers → Custom Domains).
7. `cd ../dashboard && vercel link && vercel --prod` — then Vercel dashboard → Domains → add `app.getwebfetch.com`.
8. `cd ../landing && vercel link && vercel --prod` — then Vercel dashboard → Domains → add `getwebfetch.com` (apex + www).
9. `cd ../../vscode-extension && vsce publish --packagePath ../dist-release/webfetch-0.1.0.vsix`
10. `cd ../packages/sdk-python && poetry publish --dist-dir ../../dist-release/`

## Launch day sequence (one day later)

- 06:00 PT — Show HN post (`cloud/landing/launch/hn-show.md`)
- 08:00 PT — X/Twitter thread (`cloud/landing/launch/x-thread.md`)
- 10:00 PT — Product Hunt launch (`cloud/landing/launch/product-hunt.md`)
- Evening — dev.to article (`cloud/landing/launch/devto-post.md`)
- D+1 — YouTuber outreach from `cloud/landing/launch/youtube-outreach.md`

## If something goes wrong

- **npm publish fails on one package**: the `release.yml` workflow is idempotent. Fix + rerun: `gh workflow run release.yml -f tag=v0.1.0`. If a single package already published, delete the tag-push job and re-publish manually with `npm publish --access public` from that package.
- **Worker deploy fails**: `wrangler rollback` reverts to previous version. D1 migrations are forward-only — if a migration failed, fix the SQL and re-run `wrangler d1 migrations apply webfetch-prod --remote`.
- **Vercel domain doesn't verify**: Check apex A/AAAA and www CNAME per Vercel's domain pane. DNS propagation on .sh can take 30-60 min.
- **Stripe webhook 400s**: Confirm `STRIPE_WEBHOOK_SECRET` in worker matches the endpoint's signing secret exactly. Resend a test event from Stripe dashboard.
- **Homebrew tap PR not created**: Check `HOMEBREW_GH_TOKEN` has `repo` scope on `ashlrai/homebrew-webfetch`, then re-run the release workflow.

## Support

- Full runbook: `LAUNCH.md` (every step, every rollback)
- Release process: `RELEASING.md`
- Preflight gate: `bash scripts/preflight.sh` (must exit 0 before step 4)
- Security contact: `security@getwebfetch.com`
