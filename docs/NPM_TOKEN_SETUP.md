# NPM_TOKEN setup — one-time, forever headless

> Goal: create a single npm Granular Access Token (GAT), paste it into
> `NPM_TOKEN` on `ashlrai/webfetch`, then never touch npm from a browser
> again. Tag pushes (`git push --tags`) will publish all 5 packages with
> provenance via GitHub Actions.

## Table of contents

1. [Why a GAT and not OIDC-only](#1-why-a-gat-and-not-oidc-only)
2. [Reserve the @webfetch scope](#2-reserve-the-webfetch-scope)
3. [Generate the Granular Access Token](#3-generate-the-granular-access-token)
4. [Store the token as a GitHub Actions secret](#4-store-the-token-as-a-github-actions-secret)
5. [Dry-run + first release](#5-dry-run--first-release)
6. [Rotation + revocation](#6-rotation--revocation)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Why a GAT and not OIDC-only

`npm publish --provenance` uses OIDC (`id-token: write`) to **sign** the
publish with a transparent attestation, but it still requires a **publish
credential**. npm has not yet shipped tokenless-publishing-via-OIDC for
scoped orgs. So the minimum-friction path is:

- Generate ONE Granular Access Token, scoped to `@webfetch/*`, 365-day
  expiration.
- Paste it into `secrets.NPM_TOKEN`.
- Let CI do the rest. Forever headless until the token expires.

The existing workflow at `.github/workflows/release.yml` already:

- triggers on `v*` tags,
- has `permissions: contents: write, id-token: write`,
- runs `npm publish --access public --provenance` for each of
  `@webfetch/{core,cli,mcp,server}`,
- uses `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

## 2. Reserve the @webfetch scope

The scope is reserved at first publish. Two preconditions:

1. You are logged in to npm as a member of the `@webfetch` org, or you own
   it as a user scope. Confirm in browser:
   https://www.npmjs.com/settings/masonwyatt23/packages

2. Every `packages/*/package.json` has `"publishConfig": { "access":
   "public" }` — CI also passes `--access public` as a belt-and-suspenders
   guard. Confirmed present in-repo.

No separate "reservation" step is required on npm for user-scoped
packages. On first publish of `@webfetch/core`, the scope is locked to
your account.

Sanity-check the repo is correctly wired on the GitHub side:

```bash
gh api /repos/ashlrai/webfetch --jq '{name, private, default_branch, permissions}'
gh api /repos/ashlrai/webfetch/actions/secrets --jq '.secrets[].name'
```

## 3. Generate the Granular Access Token

1. Open: https://www.npmjs.com/settings/masonwyatt23/tokens
2. Click **Generate New Token** → choose **Granular Access Token**
   (**NOT** "Classic Token").
3. Fill in:
   - **Name:** `webfetch-automation-gha`
   - **Description:** `GitHub Actions publish from ashlrai/webfetch on v* tags`
   - **Expiration:** `365 days`
   - **Packages and scopes:** select the `@webfetch` scope, all packages.
   - **Permissions:** `Read and write` on packages.
   - **Organizations:** leave empty unless you've created a true org.
   - **IP allowlist:** optional; skip for GitHub-hosted runners because
     the IP space is too broad.
4. Click **Generate Token** → confirm with a passkey / 2FA touch.
   **This is the only passkey touch for the next 365 days.**
5. Copy the full `npm_...` token string to clipboard. npm only shows it
   once.

## 4. Store the token as a GitHub Actions secret

Paste directly from clipboard — do NOT echo it into your shell history:

```bash
gh secret set NPM_TOKEN -R ashlrai/webfetch
# paste the npm_... token when prompted, press Ctrl-D
```

Or in one shot (if you're comfortable with it in history for 30 seconds;
`history -d $(history 1)` to scrub):

```bash
gh secret set NPM_TOKEN -R ashlrai/webfetch --body "npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Verify:

```bash
gh secret list -R ashlrai/webfetch
# NPM_TOKEN  Updated YYYY-MM-DD
```

Also confirm `HOMEBREW_GH_TOKEN` exists (used by the homebrew-bump job):

```bash
gh secret list -R ashlrai/webfetch | grep HOMEBREW_GH_TOKEN
```

## 5. Dry-run + first release

Preflight locally (no auth required — this just validates the tarball
contents):

```bash
cd ~/Desktop/webfetch
for pkg in core cli mcp server; do
  (cd packages/$pkg && npm pack --dry-run | tail -5)
done
```

Cut the first release:

```bash
cd ~/Desktop/webfetch
git tag v0.1.0
git push --tags
```

Watch:

```bash
gh run watch -R ashlrai/webfetch
```

On success, you get:

- `@webfetch/{core,cli,mcp,server}@0.1.0` on npm with provenance badges
- GitHub Release `v0.1.0` with 4 `.tgz` artifacts attached
- A PR on `ashlrai/homebrew-webfetch` bumping `Formula/webfetch.rb`

## 6. Rotation + revocation

- **Rotate:** generate a new GAT with the same name+scope, `gh secret
  set NPM_TOKEN` again, revoke the old token.
- **Revoke immediately if leaked:**
  https://www.npmjs.com/settings/masonwyatt23/tokens → Revoke. Then
  rotate in CI. The provenance signatures for previously-published
  versions stay valid.
- **Calendar reminder:** set a 355-day reminder to rotate before
  expiration — CI will start failing on day 366 otherwise.

## 7. Troubleshooting

| Symptom                                          | Fix                                                                     |
|--------------------------------------------------|-------------------------------------------------------------------------|
| `E404` on first publish                          | Scope not owned yet — run `npm whoami` locally and publish `core` once manually, then revert to CI. |
| `E403 You do not have permission to publish`     | GAT scope doesn't include `@webfetch` — regenerate with correct scope.  |
| `ENEEDAUTH` in CI                                | `NPM_TOKEN` secret missing or empty. `gh secret list` to confirm.       |
| Provenance step fails with `id-token: write`     | Workflow already sets it — check the job-level `permissions:` block.    |
| Homebrew bump PR not opened                      | `HOMEBREW_GH_TOKEN` missing or lacks `contents:write` on the tap repo.  |

---

Last verified: 2026-04-13. Maintainer: @masonwyatt23.
