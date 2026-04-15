-- 0004_better_auth_alignment.sql — align D1 schema with Better Auth expectations.
--
-- Better Auth (the npm package) reads/writes models: user/session/account/verification
-- with camelCase fields. We keep our snake_case columns and remap via Better Auth's
-- `schema` option in auth.ts, but a handful of columns Better Auth writes did not
-- exist in 0001_init.sql. This migration adds them, non-destructively, and relaxes
-- a couple of NOT NULL constraints on tables Better Auth now owns end-to-end.
--
-- D1 / SQLite notes:
--   - `ALTER TABLE ... ADD COLUMN` does not support `IF NOT EXISTS`; this migration
--     is intended to run exactly once in order. Fresh envs apply it cleanly; the
--     prod env has no Better-Auth-written rows yet (signup is returning 500), so
--     there is no data to lose.
--   - To relax NOT NULL on legacy columns we do the SQLite "create-new + copy +
--     drop + rename" dance for `verification_tokens` and `oauth_accounts`. We do
--     NOT rebuild `users` / `sessions` / `workspaces` since only additive columns
--     are needed there.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- sessions — Better Auth stores an opaque session token per row. Our previous
-- hand-rolled auth stored the token hash in `id`; the new model puts it in a
-- dedicated `token` column (unique). We also add `updated_at` which Better
-- Auth writes on session refresh.
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN token TEXT;
ALTER TABLE sessions ADD COLUMN updated_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- ---------------------------------------------------------------------------
-- oauth_accounts — Better Auth needs extra OAuth fields + an email+password
-- `password` column (Better Auth stores the hashed password on the `account`
-- row, not on `user`). We also need to relax NOT NULL on the legacy
-- `provider` / `provider_account_id` columns: Better Auth is happy to fill
-- them (mapped from `providerId` / `accountId`) but the old UNIQUE constraint
-- `(provider, provider_account_id)` is irrelevant for email/password rows
-- where those are still set from `providerId = 'credential'` and
-- `accountId = <userId>`, which is globally unique. Keep the UNIQUE.
-- ---------------------------------------------------------------------------
ALTER TABLE oauth_accounts ADD COLUMN id_token TEXT;
ALTER TABLE oauth_accounts ADD COLUMN access_token_expires_at INTEGER;
ALTER TABLE oauth_accounts ADD COLUMN refresh_token_expires_at INTEGER;
ALTER TABLE oauth_accounts ADD COLUMN scope TEXT;
ALTER TABLE oauth_accounts ADD COLUMN password TEXT;
ALTER TABLE oauth_accounts ADD COLUMN updated_at INTEGER;

-- ---------------------------------------------------------------------------
-- verification_tokens — Better Auth writes `value` (mapped to `token_hash`)
-- but does NOT write `purpose`. The legacy `purpose NOT NULL` has to become
-- nullable. Rebuild the table.
-- ---------------------------------------------------------------------------
CREATE TABLE verification_tokens_new (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  token_hash TEXT NOT NULL,     -- Better Auth: `value`
  purpose    TEXT,              -- relaxed; Better Auth does not set this
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER            -- added for Better Auth
);

INSERT INTO verification_tokens_new (id, identifier, token_hash, purpose, expires_at, created_at)
SELECT id, identifier, token_hash, purpose, expires_at, created_at
  FROM verification_tokens;

DROP INDEX IF EXISTS idx_verification_identifier;
DROP INDEX IF EXISTS idx_verification_expires;
DROP TABLE verification_tokens;
ALTER TABLE verification_tokens_new RENAME TO verification_tokens;
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification_tokens(identifier, purpose);
CREATE INDEX IF NOT EXISTS idx_verification_expires    ON verification_tokens(expires_at);

PRAGMA foreign_keys = ON;
