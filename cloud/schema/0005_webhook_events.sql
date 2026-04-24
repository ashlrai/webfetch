-- 0005_webhook_events.sql — Stripe webhook event-level idempotency.
--
-- Applied via `wrangler d1 migrations apply webfetch`.
-- Deduplicates Stripe webhook delivery retries so no event is processed twice.
-- `status='processed'` is the sealed state — future retries are early-returned.
-- `status='failed'` is retryable — next delivery attempt will re-process.

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('received', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
