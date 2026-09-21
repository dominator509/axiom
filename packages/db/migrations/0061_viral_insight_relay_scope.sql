-- AXIOM migration 0061 — model-scoped viral insight Relay cards (F-85).
-- Insight cards are durable local observations. They are not provider dispatches.

BEGIN;

ALTER TABLE relay_card
  ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES model_profile(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS relay_card_model_scope
  ON relay_card (org_id, model_id, created_at DESC, id DESC);

-- The window key is encoded in external_ref by the worker. This identity is
-- scoped to stored viral insight cards only; ordinary bundle cards retain their
-- existing dispatch uniqueness contract.
CREATE UNIQUE INDEX IF NOT EXISTS relay_card_viral_insight_identity
  ON relay_card (org_id, model_id, channel, external_ref)
  WHERE channel = 'viral_insight'
    AND state = 'stored'
    AND model_id IS NOT NULL
    AND external_ref IS NOT NULL;

COMMIT;
