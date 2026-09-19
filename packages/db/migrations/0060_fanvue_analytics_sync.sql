-- AXIOM migration 0060 — Fanvue account analytics and CRM event idempotency.
-- Provider payloads remain projection-only; no raw response column is added.

BEGIN;

ALTER TABLE fanvue_metric
  ADD COLUMN IF NOT EXISTS subscriber_events_new INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscriber_events_cancelled INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_messages INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_spender_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_end TIMESTAMPTZ;

ALTER TABLE fan_touchpoint
  ADD COLUMN IF NOT EXISTS external_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS fan_touchpoint_external_event_unique
  ON fan_touchpoint (external_event_id)
  WHERE external_event_id IS NOT NULL;

COMMIT;
