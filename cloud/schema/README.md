# webfetch Cloud — D1 schema

The migrations in this directory are applied with the Cloudflare `wrangler` CLI.
Wrangler looks up this folder via `migrations_dir = "../schema"` in
`cloud/workers/wrangler.toml`.

## Bootstrapping a new environment

```bash
# 1. Create the D1 database (first time only)
wrangler d1 create webfetch
# copy the returned database_id into cloud/workers/wrangler.toml

# 2. Apply migrations to the local SQLite shadow (used by `wrangler dev`)
bun run --cwd cloud/workers migrate:local

# 3. Apply migrations to the remote D1 (production)
bun run --cwd cloud/workers migrate:remote
```

## Adding a migration

1. Create `NNNN_description.sql` with the next sequence number.
2. Keep each migration idempotent (`IF NOT EXISTS`, `IF EXISTS`) where possible.
3. Test it locally first with `migrate:local`.
4. Commit both the SQL and any type changes in `cloud/shared/types.ts`.

## Table summary

| Table                  | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `users`                | Identity (Better Auth).                         |
| `oauth_accounts`       | Google / GitHub OAuth link records.             |
| `sessions`             | Dashboard cookie sessions.                      |
| `verification_tokens`  | Email verify / password reset / magic link.     |
| `workspaces`           | Billing + quota boundary.                       |
| `members`              | Workspace membership + RBAC role.               |
| `invitations`          | Pending seat invites.                           |
| `api_keys`             | `wf_live_*` bearer tokens (hashed).             |
| `usage_rows`           | Per-request metering rows.                      |
| `subscriptions`        | Local mirror of Stripe subscription state.      |
| `audit_log`            | Security / billing relevant audit trail.        |
| `cache_index`          | R2 blob metadata.                               |
