-- 0013_org_viral_sharing.sql
-- F-86 (L2.8 §8): opt-in org-level cross-model pattern sharing. When enabled,
-- generation may retrieve viral exemplars from ALL models in the org (same
-- tenant only — RLS still isolates across orgs). Off by default.
BEGIN;

ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS viral_sharing BOOLEAN NOT NULL DEFAULT false;

COMMIT;
