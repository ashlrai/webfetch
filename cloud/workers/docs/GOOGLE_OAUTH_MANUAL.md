# Google OAuth 2.0 Client — Manual Setup (webfetch)

## Why this is manual

Google does not expose a programmatic API for creating standard OAuth 2.0
"Web Application" clients used for end-user sign-in. The only automated paths
are:

- **IAP OAuth Admin APIs** — deprecated, shut down **March 19, 2026** (past).
  Also requires a Workspace organization (Mason's personal Google account
  has none). `gcloud alpha iap oauth-brands create` returns
  `INVALID_ARGUMENT: Project must belong to an organization.`
- **Workforce Identity Federation** (`gcloud iam oauth-clients create`) —
  for enterprise workforce SSO, not public end-user Google sign-in.
- Direct REST to the Credentials console — CSRF-protected, not scriptable.

So this has to be clicked through the console once. Project
`webfetch-oauth` has already been created and set active via gcloud.

## 6-step path

1. Open https://console.cloud.google.com/apis/credentials/consent?project=webfetch-oauth
   → User Type = **External** → Create. Fill:
   - App name: `webfetch`
   - User support email: `masonwyatt2003@gmail.com`
   - Developer contact email: `masonwyatt2003@gmail.com`
   - Authorized domain: `getwebfetch.com`
   → Save and Continue through Scopes (skip), Test users (skip), Summary.

2. Open https://console.cloud.google.com/apis/credentials?project=webfetch-oauth
   → **+ CREATE CREDENTIALS** → **OAuth client ID**.

3. Application type: **Web application**. Name: `webfetch-production`.

4. **Authorized JavaScript origins** — Add:
   - `https://app.getwebfetch.com`
   - `https://getwebfetch.com`

5. **Authorized redirect URIs** — Add:
   - `https://api.getwebfetch.com/auth/callback/google`

   Click **Create**. Copy the Client ID and Client Secret from the modal
   (the secret is shown only once — if you miss it, download the JSON).

6. From `cloud/workers/`, wire the secrets and redeploy:

   ```bash
   cd /Users/masonwyatt/Desktop/web-fetcher-mcp/cloud/workers
   printf '%s' 'PASTE_CLIENT_ID'     | npx wrangler secret put GOOGLE_CLIENT_ID
   printf '%s' 'PASTE_CLIENT_SECRET' | npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler deploy
   ```

## Smoke test

```bash
curl -sI 'https://api.getwebfetch.com/auth/sign-in/social?provider=google' \
  | grep -iE '^(location|HTTP)'
```

Expect `HTTP/2 302` and a `location:` header pointing to
`https://accounts.google.com/o/oauth2/v2/auth?...&client_id=<your-id>...`.

## Current state (as of this run)

- GCP project: `webfetch-oauth` (created via `gcloud projects create`, active).
- `iap.googleapis.com` enabled (unused; harmless).
- No billing account attached — not required for OAuth.
- No secrets set on the Worker yet; `wrangler deploy` not re-run.

## Three things that would have worked differently / gaps

1. **No public "Create OAuth Web Client" API.** Google intentionally keeps
   this console-only to prevent automated phishing-app creation. The
   closest alternatives (IAP OAuth Admin, Workforce Identity) don't apply
   here. A realistic automation path would be Chrome MCP driving the
   console with a logged-in session, but brittle and not worth <10 min
   budget.
2. **IAP path is dead.** Even if Mason had a Workspace org, the IAP OAuth
   Admin API was permanently shut down on 2026-03-19 — today is 2026-04-13.
   Any tutorial older than ~late 2025 recommending `gcloud iap oauth-brands`
   is obsolete.
3. **No Terraform resource either.** `google_iap_client` / `google_iap_brand`
   exist in the Terraform provider but hit the same deprecated backend;
   there is no `google_oauth_client` resource for standard web clients.
   Pulumi, Deployment Manager, and the Admin SDK all lack it as well.

## Sources

- Google Cloud: Programmatically creating OAuth clients for IAP — https://docs.cloud.google.com/iap/docs/programmatic-oauth-clients
- Google Cloud IAM: Manage OAuth application (Workforce) — https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app
- Google API Console: Setting up OAuth 2.0 — https://support.google.com/googleapi/answer/6158849
- Google Cloud Console Help: Manage OAuth Clients — https://support.google.com/cloud/answer/15549257
