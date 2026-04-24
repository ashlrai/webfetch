# webfetch — Launch Runbook

Single-source checklist for shipping webfetch v0.1.0 end-to-end. Run sections in order. Every command is copy-pasteable. Rollback notes at the bottom of each irreversible section and consolidated in section 12.

Before starting any section, run:

```bash
bash scripts/preflight.sh
```

Do not proceed to section 3 until preflight exits 0.

---

## Table of Contents

1. Pre-launch (async accounts, domains, scopes)
2. Secrets setup (GitHub repo secrets)
3. First push + OSS launch (npm, Docker, Homebrew via CI)
4. Cloud backend deploy (Cloudflare Workers + D1 + KV + R2 + Queues)
5. Dashboard deploy (Vercel)
6. Landing site deploy (Vercel)
7. VS Code extension publish
8. Python SDK publish
9. MCP registry submissions
10. Public launch sequence (HN, X, PH, dev.to, YouTube)
11. Post-launch monitoring
12. Rollback notes (consolidated)

---

## 1. Pre-launch

These can be done asynchronously, in parallel, days before launch day.

### 1.1 Domain

```bash
# Register getwebfetch.com at your registrar of choice.
# Recommended: Cloudflare Registrar (no markup, free WHOIS privacy).
# After purchase, do nothing with DNS yet — Cloudflare zone setup happens in step 4.
```

### 1.2 npm scope

```bash
npm login
npm whoami
# Verify the @webfetch scope is available:
npm access list packages @webfetch || echo "scope free"
# Reserve by publishing a placeholder if necessary; we will publish real packages in step 3.
```

If `@webfetch` is taken, decide on alternate scope (e.g. `@webfetch-dev`) and update every `package.json` `"name"` field before continuing.

### 1.3 GitHub repos

Create two empty public repos under the `ashlrai` org:

```bash
gh repo create ashlrai/webfetch --public --description "Headless web fetcher with MCP, CLI, and SDKs" --homepage "https://getwebfetch.com"
gh repo create ashlrai/homebrew-webfetch --public --description "Homebrew tap for webfetch"
```

### 1.4 Cloudflare account

1. Sign in at https://dash.cloudflare.com.
2. Add `getwebfetch.com` as a zone (Websites -> Add a site).
3. Update nameservers at the registrar to Cloudflare's.
4. Create an API token with permissions: `Account.Workers Scripts:Edit`, `Account.D1:Edit`, `Account.Workers KV Storage:Edit`, `Account.Workers R2 Storage:Edit`, `Account.Queues:Edit`, `Zone.Workers Routes:Edit` (scope to the getwebfetch.com zone). Store as `CLOUDFLARE_API_TOKEN`.

### 1.5 Stripe

1. Sign in at https://dashboard.stripe.com.
2. Open `cloud/shared/pricing.ts` and create the 4 products with matching prices (Free, Pro, Team, Enterprise) in **live mode**. Copy each price ID into `cloud/shared/pricing.ts` if not already populated.
3. Get `STRIPE_SECRET_KEY` (live mode `sk_live_...`).
4. Configure a webhook endpoint: `https://api.getwebfetch.com/stripe/webhook` (will exist after step 4). Capture the signing secret as `STRIPE_WEBHOOK_SECRET`.

### 1.6 SendGrid

1. Sign up at https://sendgrid.com.
2. Authenticate the `getwebfetch.com` sender domain (Settings → Sender Authentication → DKIM + SPF + DMARC records in Cloudflare DNS).
3. Create an API key (Settings → API Keys → Restricted Access with **Mail Send** permission only), store as `SENDGRID_API_KEY`.

### 1.7 Vercel

```bash
npm i -g vercel
vercel login
vercel teams ls   # confirm the right team is selected
```

Capture a token at https://vercel.com/account/tokens for CI as `VERCEL_TOKEN`.

### 1.8 npm + GHCR + Homebrew tokens

```bash
# npm: https://www.npmjs.com/settings/<user>/tokens -> Granular access token, scope @webfetch, "Read and write".
# GHCR: gh auth token  (or PAT with write:packages, read:packages).
# Homebrew tap PAT: a fine-grained PAT with contents:write on ashlrai/homebrew-webfetch.
```

---

## 2. Secrets setup

Run from inside the cloned `ashlrai/webfetch` repo (after step 3.1) — listed here for reference. Replace the trailing string with the real value. Use `gh secret set --env <env>` instead of repo-level for environment-scoped secrets if preferred.

```bash
gh secret set NPM_TOKEN              --body "npm_xxx"
gh secret set GHCR_TOKEN             --body "ghp_xxx"
gh secret set HOMEBREW_GH_TOKEN      --body "github_pat_xxx"
gh secret set CLOUDFLARE_API_TOKEN   --body "xxx"
gh secret set CLOUDFLARE_ACCOUNT_ID  --body "xxx"
gh secret set STRIPE_SECRET_KEY      --body "sk_live_xxx"
gh secret set STRIPE_WEBHOOK_SECRET  --body "whsec_xxx"
gh secret set SENDGRID_API_KEY       --body "SG.xxx"
gh secret set VERCEL_TOKEN           --body "xxx"
gh secret set VERCEL_ORG_ID          --body "team_xxx"
gh secret set VERCEL_PROJECT_LANDING --body "prj_xxx"
gh secret set VERCEL_PROJECT_DASH    --body "prj_xxx"
gh secret set VSCE_TOKEN             --body "xxx"   # set after step 7.1
gh secret set PYPI_TOKEN             --body "pypi-xxx"
```

Verify:

```bash
gh secret list
```

---

## 3. First push + OSS launch

### 3.1 Push the reference workspace

```bash
cd ~/Desktop/web-fetcher-mcp
git init
git add .
git commit -m "Initial commit: webfetch v0.1.0"
git branch -M main
git remote add origin git@github.com:ashlrai/webfetch.git
git push -u origin main
```

### 3.2 Verify CI green

```bash
gh run watch
# Or: open https://github.com/ashlrai/webfetch/actions
```

Required workflows: `ci.yml`, `install-test.yml`. Do not proceed if any required check is red.

### 3.3 Tag v0.1.0

```bash
# Confirm version in every package.json + pyproject.toml is 0.1.0.
git tag -a v0.1.0 -m "webfetch 0.1.0"
git push origin v0.1.0
```

> Pre-built artifacts available in `dist-release/` (built by `scripts/preflight.sh` / local prep). To skip the CI round-trip and publish directly:
> ```bash
> npm publish dist-release/webfetch-core-0.1.0.tgz    --access public
> npm publish dist-release/webfetch-cli-0.1.0.tgz     --access public
> npm publish dist-release/webfetch-mcp-0.1.0.tgz     --access public
> npm publish dist-release/webfetch-server-0.1.0.tgz  --access public
> npm publish dist-release/webfetch-browser-0.1.0.tgz --access public
> ```
> Note: local tarballs lack npm provenance attestation. Tag-driven CI publish is preferred when provenance matters.

This triggers `release.yml` (npm publish for each `packages/*`) and `docker.yml` (push to ghcr.io/ashlrai/webfetch:0.1.0 + :latest). Watch:

```bash
gh run watch
```

### 3.4 Verify published artifacts

```bash
npm view @webfetch/core version
npm view @webfetch/cli version
npm view @webfetch/mcp version
npm view @webfetch/server version
npm view @webfetch/browser version

docker pull ghcr.io/ashlrai/webfetch:0.1.0
docker run --rm ghcr.io/ashlrai/webfetch:0.1.0 --version
```

### 3.5 Homebrew tap

The `release.yml` job opens a PR against `ashlrai/homebrew-webfetch` updating `Formula/webfetch.rb` (templated from `homebrew/webfetch.rb`). Review and merge:

```bash
gh pr list --repo ashlrai/homebrew-webfetch
gh pr merge <num> --repo ashlrai/homebrew-webfetch --squash
```

Smoke test:

```bash
brew tap ashlrai/webfetch
brew install webfetch
webfetch --version
```

---

## 4. Cloud backend deploy (Cloudflare)

All commands run from `cloud/workers/`.

### 4.1 Login + create resources

```bash
cd cloud/workers
npx wrangler login

# D1 database
npx wrangler d1 create webfetch-prod
# -> copy the database_id from the output
```

Edit `cloud/workers/wrangler.toml` and paste the `database_id` into the `[[d1_databases]]` block (replace any placeholder).

```bash
# KV namespaces
npx wrangler kv:namespace create CACHE
npx wrangler kv:namespace create RATE_LIMIT
# -> paste each id into wrangler.toml [[kv_namespaces]] entries

# R2 bucket
npx wrangler r2 bucket create webfetch-artifacts

# Queues
npx wrangler queues create webfetch-jobs
npx wrangler queues create webfetch-jobs-dlq
```

### 4.2 Apply migrations

```bash
npx wrangler d1 migrations apply webfetch-prod --remote
# Or, if migrations are stored as plain SQL in cloud/schema/:
npx wrangler d1 execute webfetch-prod --remote --file=../schema/0001_init.sql
npx wrangler d1 execute webfetch-prod --remote --file=../schema/0002_indexes.sql
```

### 4.3 Set Worker secrets

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put SENDGRID_API_KEY
npx wrangler secret put BETTER_AUTH_SECRET   # 32+ random bytes
npx wrangler secret put JWT_SIGNING_KEY      # 32+ random bytes
```

Generate random secrets:

```bash
openssl rand -base64 48
```

### 4.4 Deploy

```bash
npx wrangler deploy --env production
```

### 4.5 Custom route

In Cloudflare dashboard -> getwebfetch.com zone -> Workers Routes:

- Pattern: `api.getwebfetch.com/*`
- Worker: `webfetch-api` (or whatever `name` is in `wrangler.toml`)

Or via CLI (already declared in `wrangler.toml [[routes]]` block, pushed by `wrangler deploy`).

### 4.6 Verify

```bash
curl https://api.getwebfetch.com/v1/health
# -> {"ok":true,"version":"0.1.0"}
```

---

## 5. Dashboard deploy (Vercel)

```bash
cd cloud/dashboard
vercel link               # select ashlrai team, name "webfetch-dashboard"
```

Set environment variables in Vercel project settings (Production scope):

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://api.getwebfetch.com` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_xxx` |
| `BETTER_AUTH_SECRET` | same as Worker secret |
| `BETTER_AUTH_URL` | `https://app.getwebfetch.com` |
| `DATABASE_URL` | (if dashboard has its own DB connection; otherwise omit) |

Add domain:

```bash
vercel domains add app.getwebfetch.com
vercel alias set webfetch-dashboard.vercel.app app.getwebfetch.com
```

Deploy production:

```bash
vercel --prod
```

---

## 6. Landing site deploy (Vercel)

```bash
cd cloud/landing
vercel link               # select ashlrai team, name "webfetch-landing"
vercel domains add getwebfetch.com
vercel domains add www.getwebfetch.com
vercel --prod
```

Verify OG image is publicly reachable:

```bash
curl -I https://getwebfetch.com/og-image.png
# Should be 200 with image/png. If the file is currently SVG, generate a PNG:
#   npx @resvg/resvg-js cloud/landing/public/og-image.svg cloud/landing/public/og-image.png --width 1200
# Re-deploy after committing.
```

Test OG rendering at https://www.opengraph.xyz/url/https%3A%2F%2Fgetwebfetch.com.

---

## 7. VS Code extension publish

### 7.1 First-time setup

```bash
npm i -g @vscode/vsce
# Create a publisher named "ashlrai" at https://marketplace.visualstudio.com/manage if not done.
# Generate a PAT with scope: Marketplace > Manage at https://dev.azure.com.
vsce login ashlrai     # paste the PAT
```

### 7.2 Publish

```bash
cd vscode-extension
vsce package
vsce publish --pat "$VSCE_TOKEN"
```

> Pre-built artifact available at `dist-release/webfetch-0.1.0.vsix` — publish it directly without rebuilding:
> ```bash
> npx vsce publish --packagePath dist-release/webfetch-0.1.0.vsix --pat "$VSCE_TOKEN"
> ```

Verify at https://marketplace.visualstudio.com/items?itemName=ashlrai.webfetch.

---

## 8. Python SDK publish

```bash
cd packages/sdk-python
poetry config pypi-token.pypi "$PYPI_TOKEN"
poetry build
poetry publish
```

> Pre-built wheel + sdist available in `dist-release/`:
> ```bash
> python3 -m pip install --user twine
> TWINE_USERNAME=__token__ TWINE_PASSWORD="$PYPI_TOKEN" \
>   python3 -m twine upload \
>     dist-release/webfetch-0.1.0-py3-none-any.whl \
>     dist-release/webfetch-python-0.1.0.tar.gz
> ```

Verify:

```bash
pip install webfetch
python -c "import webfetch; print(webfetch.__version__)"
```

---

## 9. MCP registry submissions

### 9.1 mcpservers.org

Manual PR against https://github.com/mcp-servers/registry. Add an entry under `servers/`:

```bash
gh repo fork mcp-servers/registry --clone
cd registry
# Add servers/webfetch.json with name, description, install command, repo URL.
git checkout -b add-webfetch
git add servers/webfetch.json
git commit -m "Add webfetch"
gh pr create --title "Add webfetch" --body "Headless web fetcher with MCP server, CLI, SDKs."
```

### 9.2 Smithery

Submit at https://smithery.ai/submit. Provide:

- Repo: `ashlrai/webfetch`
- Install command: `npx -y @webfetch/mcp`
- Description: from `packages/mcp/package.json`

### 9.3 mcp.run

Submit at https://www.mcp.run/onboard. Same metadata as Smithery.

---

## 10. Public launch sequence

All times in PT. Stagger to maximize coverage; if HN doesn't pop in the first hour, do not bump.

| Time | Action | Source |
| --- | --- | --- |
| 06:00 | Submit Show HN | `cloud/landing/launch/hn-show.md` |
| 08:00 | Post X thread | `cloud/landing/launch/x-thread.md` |
| 10:00 | Launch on Product Hunt | `cloud/landing/launch/product-hunt.md` |
| Throughout | Reply to every comment within 15 min | — |
| Throughout | Hot-fix bugs as they surface; cut patch releases via `git tag v0.1.x` | — |
| 18:00 | Cross-post to dev.to | `cloud/landing/launch/devto-post.md` |
| Day +1 09:00 | Email 10 YouTubers | `cloud/landing/launch/youtube-outreach.md` |

### 10.1 HN

```bash
# Open: https://news.ycombinator.com/submit
# Title: from hn-show.md
# URL: https://getwebfetch.com
# Text: from hn-show.md (the "first comment" goes in the text field)
```

### 10.2 Product Hunt

Schedule the night before at https://www.producthunt.com/posts/new. Set "go live" to 00:01 PT (PH day starts at midnight). Use the gallery, tagline, and first-comment from `cloud/landing/launch/product-hunt.md`.

### 10.3 X thread

Paste each tweet from `x-thread.md` as a reply chain. Pin the first.

---

## 11. Post-launch monitoring

### 11.1 Real-time

```bash
# Tail Worker logs
cd cloud/workers
npx wrangler tail --env production --format pretty

# Tail Vercel landing
vercel logs https://getwebfetch.com --follow

# Tail Vercel dashboard
vercel logs https://app.getwebfetch.com --follow
```

### 11.2 Dashboards

- Cloudflare Workers analytics: https://dash.cloudflare.com -> Workers -> webfetch-api
- Stripe payments: https://dashboard.stripe.com/payments
- npm downloads: `npx npm-stat @webfetch/cli`
- GitHub stars: `gh api repos/ashlrai/webfetch | jq .stargazers_count`

### 11.3 Community

- GitHub Discussions: respond within 1 hour during launch day
- Discord (if configured): pin a "first 24h" announcement
- HN/PH/X comments: 15-minute SLA

---

## 12. Rollback notes

Every irreversible action and how to undo it. Keep this section open in a tab on launch day.

### 12.1 npm publish

```bash
# Within 72 hours of publish you can fully unpublish:
npm unpublish @webfetch/cli@0.1.0 --force

# After 72 hours, deprecate instead:
npm deprecate @webfetch/cli@0.1.0 "Use 0.1.1+; see CHANGELOG"
# Then publish a fixed 0.1.1.
```

### 12.2 GitHub release / git tag

```bash
git push origin :refs/tags/v0.1.0           # delete remote tag
gh release delete v0.1.0 --yes              # delete release
git revert <bad-sha>                         # create revert commit
git tag v0.1.1 && git push origin v0.1.1     # ship the fix
```

### 12.3 Docker image

```bash
# Cannot delete a published tag from GHCR via API in most cases; instead:
docker buildx imagetools create -t ghcr.io/ashlrai/webfetch:latest ghcr.io/ashlrai/webfetch:0.1.1
# Mark the bad tag deprecated in the README and via a release note.
```

### 12.4 Cloudflare Worker

```bash
cd cloud/workers
npx wrangler rollback --env production
# Or deploy a known-good commit:
git checkout <good-sha> -- src/
npx wrangler deploy --env production
git checkout HEAD -- src/
```

### 12.5 D1 migrations

```bash
# Every forward migration must have a paired down migration in cloud/schema/.
# To roll back the most recent:
npx wrangler d1 execute webfetch-prod --remote --file=../schema/0002_indexes.down.sql
```

### 12.6 Vercel deploys

```bash
vercel rollback https://getwebfetch.com
vercel rollback https://app.getwebfetch.com
```

### 12.7 DNS

DNS is fully reversible. In Cloudflare dashboard, swap A/CNAME records back to the previous targets. TTL is typically 5 minutes for proxied records.

### 12.8 Stripe

Stripe products and prices cannot be deleted, only archived. To pull a bad price out of circulation:

1. Stripe dashboard -> Products -> select product -> Archive price.
2. Update `cloud/shared/pricing.ts` with the replacement price ID.
3. Redeploy Worker + dashboard.

### 12.9 VS Code marketplace

```bash
vsce unpublish ashlrai.webfetch@0.1.0
# Then republish a fixed 0.1.1.
```

### 12.10 PyPI

PyPI does **not** allow re-uploading the same version. To recover:

```bash
# Yank the bad version (still installable by pinning, but hidden from default resolution):
twine yank webfetch -v 0.1.0 --reason "broken release"
# Publish 0.1.1 with the fix.
```

---

## Appendix: launch-day on-call rotation

| Window (PT) | On-call | Backup |
| --- | --- | --- |
| 06:00 - 12:00 | Mason | — |
| 12:00 - 18:00 | Mason | — |
| 18:00 - 00:00 | Mason | — |

Update with co-founders/contractors as they come online. Single-operator launch is fine; just block the calendar.
