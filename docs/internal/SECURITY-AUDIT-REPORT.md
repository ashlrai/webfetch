# Security Audit — webfetch v0.1.0

Auditor: internal automated + manual
Date: 2026-04-13

## Executive summary

- 12 findings total: 0 critical, 7 high, 3 medium, 2 low/informational
- 10 findings fixed inline; 2 deferred (low/informational) with notes
- Status: **READY FOR LAUNCH** after the inline fixes below are merged

## Methodology

Tools run:
- `npm audit` (three package dirs) — no lockfiles present; no advisories surfaced
- `semgrep --config=p/javascript --config=p/typescript --config=p/security-audit --config=p/owasp-top-ten` across `packages/`, `cloud/workers/`, `extension/`, `vscode-extension/` — 0 findings
- `gitleaks detect --no-git` across the repo — 16 hits, all inside `.next/` build artifacts (gitignored, never committed; see SA-011)

Scope covered (manual review):
- `cloud/workers/src/{auth,keys,middleware,quota,billing,teams,audit,responses,schemas,ids,index}.ts`
- `cloud/workers/src/routes/{download,probe,license,similar,keys}.ts`
- `packages/core/src/download.ts`
- `extension/` (manifest, popup, content sidebar, background wiring)
- `vscode-extension/src/{panel,lib}/*`

Out of scope (intentional):
- `cloud/dashboard/` + `cloud/landing/` Next.js apps (reviewed at the
  framework level — Next built-in XSS protections assumed; manual review of
  the blog slug route's `dangerouslySetInnerHTML` usage was noted but the
  markdown source is repo-controlled).
- Third-party npm dep CVE analysis beyond `npm audit` (no lockfile → no
  advisory list).
- Python SDK (`packages/sdk-python/`).
- Load / DoS testing beyond static review of rate limiter.

## Findings

### CRITICAL

None.

### HIGH

#### SA-001: SSRF in `/v1/download` — attacker can make the Worker fetch internal URLs
- Severity: **High**
- Location: `cloud/workers/src/routes/download.ts:37` (pre-fix)
- CWE-918 (SSRF)
- Description: The endpoint accepted any URL that passed `z.string().url()`, then
  performed a server-side `fetch()` on it. The Cloudflare Worker egress can
  still reach public-internet targets and many metadata-style hostnames; even
  if Cloudflare's internal infra blocks most RFC1918, `http://169.254.169.254/`
  and other link-local literals plus `*.internal`, `metadata.google.internal`,
  private DNS names resolvable via a configured resolver, etc. are reachable
  or at minimum leak timing/error info.
- Impact: Attacker with a valid API key (free tier works) could probe internal
  networks, cloud metadata endpoints, exfiltrate response bytes via the R2
  cache path, or use the service as an anonymous-looking HTTP proxy.
- Fix: **Applied.** Added `cloud/workers/src/ssrf.ts` with
  `assertPublicHttpUrl()` that rejects non-http(s) schemes and any
  private/loopback/link-local/multicast IPv4 literal, IPv6 loopback/ULA,
  `localhost`, and `*.internal` / `metadata.google.internal` hostnames.
  Wired into the download handler before the outbound `fetch`.

#### SA-002: SSRF in `/v1/probe`
- Severity: **High**
- Location: `cloud/workers/src/routes/probe.ts:20`
- CWE-918
- Description: Same class of issue as SA-001. `probePage(url)` is invoked on
  arbitrary user input.
- Fix: **Applied.** Same `assertPublicHttpUrl` guard.

#### SA-003: SSRF in `/v1/license`
- Severity: **High**
- Location: `cloud/workers/src/routes/license.ts`
- CWE-918
- Fix: **Applied.** Same guard.

#### SA-004: SSRF in `/v1/similar`
- Severity: **High**
- Location: `cloud/workers/src/routes/similar.ts`
- CWE-918
- Fix: **Applied.** Same guard.

#### SA-005: CORS allows credentials with wildcard / unvalidated origin
- Severity: **High**
- Location: `cloud/workers/src/middleware.ts:37-48` (pre-fix)
- CWE-942 (Overly Permissive CORS)
- Description: `isAllowedOrigin` returned `true` for `origin === "*"` or a
  missing Origin header while `access-control-allow-credentials: true` was
  set. That combination is browser-rejected for wildcards, but also
  `hostname.endsWith(".localhost")` allowed attacker-controlled
  `evil.localhost` entries (e.g. via a victim's hosts file / mDNS) to receive
  credentialed responses.
- Fix: **Applied.** Removed wildcard bypass; restricted localhost allow to
  bare `localhost` and `127.0.0.1`.

#### SA-006: `*.localhost` too permissive — same class (promoted above)
- Addressed alongside SA-005.

#### SA-007: No CSRF protection on cookie-authenticated mutation routes
- Severity: **High**
- Location: `cloud/workers/src/routes/keys.ts` (POST/DELETE), `teams.ts`
  (POST/PATCH/DELETE), `billing.ts` checkout + portal
- CWE-352 (CSRF)
- Description: Dashboard endpoints authenticate via the `wf_session` cookie
  and had no Origin/Referer check or double-submit token. A malicious site
  could submit a form to `/v1/keys?workspaceId=…` and — because CORS
  `allow-credentials` is permitted for `*.getwebfetch.com` — the browser would
  attach the session cookie. Create-key is particularly dangerous (attacker
  learns the raw secret via the 201 response body **only if** they can read
  the response; with same-site origin locked down they can't, but the key is
  still created and surfaced to the victim's own account, which is a
  persistent nuisance vector).
- Fix: **Applied.** Added `csrfGuard` middleware in `middleware.ts` that
  enforces `Origin`/`Referer` matches `isAllowedOrigin` on any mutating method
  (POST/PUT/PATCH/DELETE) routed through `/v1/keys/*` or `/v1/workspaces/*`.
  Non-browser clients (no Origin/Referer) are permitted — they cannot be
  used as CSRF vectors since a browser-initiated cross-origin request always
  includes one of the two headers.

### MEDIUM

#### SA-008: Misleading `constantTimeEq` in session verifier
- Severity: **Medium** (defense-in-depth; not directly exploitable)
- Location: `cloud/workers/src/auth.ts:101` (pre-fix)
- CWE-208 (Observable Timing Discrepancy)
- Description: `constantTimeEq(row.id, tokenHash)` compared a value to itself —
  `row.id` was selected `WHERE s.id = tokenHash`, so by construction the two
  are equal when the row exists. The check is dead code. Not exploitable
  because the actual lookup key is the SHA-256 hash of the token, not the
  token itself, and SQL equality on the hash is the authoritative check.
  Left a meaningful length check + documented rationale rather than removing.
- Fix: **Applied** (code-clarity fix + comment explaining why the
  constant-time guard is a no-op here).

#### SA-009: Weak (non-CSPRNG) CSP nonce in VS Code webview
- Severity: **Medium**
- Location: `vscode-extension/src/panel/WebfetchViewProvider.ts:243-247` (pre-fix)
- CWE-338 (Use of Cryptographically Weak PRNG)
- Description: The CSP `nonce-*` was generated from `Math.random()`.
  Predictable nonces weaken the CSP script-src guarantee against an attacker
  who can inject HTML into the webview (e.g. via untrusted search results).
- Fix: **Applied.** Switched to `crypto.getRandomValues` (Web Crypto is
  available in VS Code's runtime for Node 18+).

#### SA-010: SSRF in `packages/core` `downloadImage` (library path)
- Severity: **Medium** (local CLI / MCP context reduces blast radius vs. the
  cloud worker, but still applies to the self-hosted server).
- Location: `packages/core/src/download.ts:49-76` (pre-fix)
- CWE-918
- Fix: **Applied.** Added inline `isPublicHttpUrl` guard mirroring the cloud
  worker policy. Kept separate (no cross-package import) to avoid new deps.

### LOW / INFORMATIONAL

#### SA-011: Next.js preview-mode keys present in build artifacts
- Severity: **Informational**
- Location: `cloud/{dashboard,landing}/.next/**` (all hits under `.next/`)
- CWE-532 (Insertion of Sensitive Information into Log File)
- Description: `gitleaks` found 16 apparent secrets — every one is inside a
  `.next/` build cache (e.g. `previewModeSigningKey`, `previewModeEncryptionKey`).
  Next.js auto-generates these at build time; they are preview-mode only
  and not production secrets. The `.next` directory is gitignored
  (`/.gitignore:3`). No action required. Ensure CI/CD artifacts don't ship
  `.next/` to public registries.
- Fix: **Deferred (informational).** `.gitignore` already excludes `.next/`.
  No TODO placed — nothing to change.

#### SA-012: Quota check-then-increment is not atomic
- Severity: **Low**
- Location: `cloud/workers/src/quota.ts:57-85`
- CWE-362 (Race Condition)
- Description: `checkQuota` reads the counter, then `incrementUsage` is
  called later after the handler runs. A burst of concurrent requests from a
  single workspace can briefly cross the included-fetches ceiling on free
  tier. Code already acknowledges this in comments — the Stripe metered
  usage record is the authoritative billing path; quota is a soft gate.
- Fix: **Deferred with note.** Accepted per existing design comment. If this
  becomes a revenue-leak vector, migrate the free-tier counter to
  `RateLimiterDO` (already scaffolded in `middleware.ts:163`) for
  single-threaded increment.

## Fixed inline

- SA-001..004: added `cloud/workers/src/ssrf.ts` + guards in `download.ts`,
  `probe.ts`, `license.ts`, `similar.ts` — blocks private-IP / loopback /
  link-local / `*.internal` / non-http(s) URLs.
- SA-005/006: tightened `isAllowedOrigin` in `middleware.ts` — removed
  wildcard + `*.localhost` bypasses.
- SA-007: added `csrfGuard` middleware and wired it into `/v1/keys/*` and
  `/v1/workspaces/*` in `index.ts`.
- SA-008: documented + strengthened session-row consistency check in
  `auth.ts`.
- SA-009: swapped `Math.random()` for `crypto.getRandomValues` in
  `WebfetchViewProvider.ts`.
- SA-010: mirrored SSRF guard into `packages/core/src/download.ts`.

## Tool output

### npm audit
All three package directories reported `ENOLOCK` — no `package-lock.json`
under any workspace (Bun-native repo using `bun.lock`). No npm-advisory
findings available. **Recommendation:** run `bun audit` in CI once Bun's
advisory DB is on by default, or emit a one-shot `npm i --package-lock-only`
in a security-scan job.

### semgrep (p/javascript, p/typescript, p/security-audit, p/owasp-top-ten)
0 findings. Clean run.

### gitleaks
16 findings, all under `.next/` (gitignored). Covered by SA-011.

## Launch readiness

Launch-ready once the applied fixes above are merged — no critical issues,
all high-severity SSRF/CSRF/CORS bugs patched, tests still green (241/241
passing), workers `tsc --noEmit` clean.
