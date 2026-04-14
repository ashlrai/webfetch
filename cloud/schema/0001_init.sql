-- 0001_init.sql — webfetch Cloud schema v1.
--
-- Applied via `wrangler d1 migrations apply webfetch`.
-- D1 is SQLite-compatible; keep to the intersection of SQLite + D1 features.
-- No foreign key cascades on the workspace table to keep migrations portable;
-- referential integrity is enforced at the application layer.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- users — identity managed by Better Auth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,        -- ulid
  email         TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0, -- 0/1
  name          TEXT,
  image         TEXT,
  password_hash TEXT,                    -- null when OAuth-only
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Better Auth: oauth account linkage.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,           -- 'google' | 'github'
  provider_account_id TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE(provider, provider_account_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Better Auth: sessions (dashboard cookie auth).
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,          -- random 32-byte token hash
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Email verification + password reset tokens.
CREATE TABLE IF NOT EXISTS verification_tokens (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,              -- email or user_id
  token_hash TEXT NOT NULL,
  purpose    TEXT NOT NULL,              -- 'email' | 'password-reset' | 'magic-link'
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- workspaces — the billing + quota unit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
  id                      TEXT PRIMARY KEY,
  slug                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  owner_id                TEXT NOT NULL,
  plan                    TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  subscription_status     TEXT NOT NULL DEFAULT 'none',
  quota_resets_at         INTEGER NOT NULL,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- workspace membership + RBAC.
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL,            -- 'owner'|'admin'|'member'|'billing'|'readonly'
  invited_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Invitations awaiting accept (so we can resend / expire).
CREATE TABLE IF NOT EXISTS invitations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  invited_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- ---------------------------------------------------------------------------
-- api_keys — `wf_live_*` bearer tokens.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id                  TEXT PRIMARY KEY,  -- ulid
  workspace_id        TEXT NOT NULL,
  created_by_user_id  TEXT NOT NULL,
  prefix              TEXT NOT NULL,     -- first 12 chars for UI
  hash                TEXT NOT NULL UNIQUE, -- sha256 of raw secret
  name                TEXT NOT NULL,
  revoked_at          INTEGER,
  last_used_at        INTEGER,
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- usage_rows — per-request metering. Billing consumer aggregates these.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_rows (
  id           TEXT PRIMARY KEY,         -- ulid
  workspace_id TEXT NOT NULL,
  api_key_id   TEXT,
  user_id      TEXT,
  endpoint     TEXT NOT NULL,
  units        INTEGER NOT NULL DEFAULT 1,
  ts           INTEGER NOT NULL,
  status       INTEGER NOT NULL,
  request_id   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- subscriptions — local mirror of Stripe state for fast reads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id           TEXT PRIMARY KEY,
  stripe_customer_id     TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  plan                   TEXT NOT NULL,
  status                 TEXT NOT NULL,
  current_period_start   INTEGER,
  current_period_end     INTEGER,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  seats                  INTEGER NOT NULL DEFAULT 1,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- audit_log — RBAC-sensitive events (key rotation, plan change, seat invite).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  actor_user_id TEXT,
  action        TEXT NOT NULL,           -- 'key.create' etc.
  target_type   TEXT,
  target_id     TEXT,
  meta          TEXT,                    -- JSON, bounded to ~1KB
  ts            INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- cache_index — metadata for blobs stored in R2 (sha256 -> mime + size).
-- The actual bytes live in the CACHE R2 bucket keyed by sha256.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cache_index (
  sha256       TEXT PRIMARY KEY,
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  source_url   TEXT,
  first_seen   INTEGER NOT NULL,
  last_hit     INTEGER NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 1
);
