-- 0002_indexes.sql — hot-path indexes.
--
-- D1 cost model: SQL operations are billed on rows read/written. Every hot read
-- below has an index to bound the row count.

CREATE INDEX IF NOT EXISTS idx_sessions_user        ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires     ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_user           ON oauth_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification_tokens(identifier, purpose);
CREATE INDEX IF NOT EXISTS idx_verification_expires    ON verification_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner     ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_stripecust ON workspaces(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_members_user         ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email    ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_ws       ON invitations(workspace_id);

CREATE INDEX IF NOT EXISTS idx_keys_ws              ON api_keys(workspace_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_keys_prefix          ON api_keys(prefix);

-- usage hot-paths: (workspace, ts) for dashboard timeseries; (workspace, endpoint, ts) for breakdown.
CREATE INDEX IF NOT EXISTS idx_usage_ws_ts          ON usage_rows(workspace_id, ts);
CREATE INDEX IF NOT EXISTS idx_usage_ws_endpoint_ts ON usage_rows(workspace_id, endpoint, ts);
CREATE INDEX IF NOT EXISTS idx_usage_key_ts         ON usage_rows(api_key_id, ts);

CREATE INDEX IF NOT EXISTS idx_audit_ws_ts          ON audit_log(workspace_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor          ON audit_log(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_subs_customer        ON subscriptions(stripe_customer_id);
