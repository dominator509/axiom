-- 0074_public_sfw_funnel_settings.sql
-- Persist the model's explicitly configured private community destination for
-- the public SFW reply flow. Validation and role checks stay in the API.
BEGIN;

ALTER TABLE model_profile
  ADD COLUMN IF NOT EXISTS public_community_invite_url TEXT;

COMMIT;
