-- 0003_audit_retention.sql — per-workspace audit retention configuration.
--
-- Default retention by plan:
--   free       =  90 days
--   pro        = 180 days
--   team       = 365 days
--   enterprise = configurable via this column (default 365)
--
-- The cron in `src/cron/audit-retention.ts` archives pre-cutoff rows to R2 as
-- NDJSON before deleting them from D1.

ALTER TABLE workspaces ADD COLUMN audit_retention_days INTEGER;

-- Backfill: leave NULL so the cron falls back to the plan default. Enterprise
-- workspaces will be set explicitly via admin tooling.
UPDATE workspaces SET audit_retention_days = NULL WHERE audit_retention_days IS NULL;
