-- AXIOM migration 0065 — opt-in per-model recurring viral insights (F-85).
-- The nullable schedule UUID is both the enabled marker and a revocation token
-- for queued jobs. No schedule is enabled by default.

BEGIN;

ALTER TABLE model_profile
  ADD COLUMN IF NOT EXISTS viral_insight_schedule_id UUID;

COMMIT;
