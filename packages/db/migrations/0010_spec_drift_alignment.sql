-- 0010_spec_drift_alignment.sql
-- M-8 spec drift alignment (L3.1): aligns the live schema to the DDL spec
-- where the divergence is a genuine gap. Deliberate PK-type divergences
-- (uuid vs bigint identity) are documented in the spec instead — uuid PKs
-- are already enforced and changing them would churn every FK for no gain.
BEGIN;

-- 1. model_profile: spec UNIQUE(org_id, handle) — duplicate handles in an org
--    are now structurally impossible (verified 0 dupes before adding).
ALTER TABLE model_profile ADD CONSTRAINT model_profile_org_handle_unique UNIQUE (org_id, handle);

-- 2. org: spec kek_id text NOT NULL (KMS key id for the org's DEK, L2.12).
--    The egress plane's DEK id is the only DEK this self-hosted box uses.
ALTER TABLE org ADD COLUMN kek_id text NOT NULL DEFAULT 'egress-dek';

-- 3. consent_record: spec columns (L3.1 §2) — subject_ref, doc_kind CHECK,
--    blob_ref, sha256, valid_from/valid_to. Table is empty (0 rows), so
--    NOT NULL is lossless.
ALTER TABLE consent_record ADD COLUMN subject_ref text NOT NULL DEFAULT '';
ALTER TABLE consent_record ADD COLUMN doc_kind text NOT NULL DEFAULT 'platform_consent'
  CHECK (doc_kind IN ('2257','model_release','id_verify','platform_consent'));
ALTER TABLE consent_record ADD COLUMN blob_ref text;
ALTER TABLE consent_record ADD COLUMN sha256 bytea;
ALTER TABLE consent_record ADD COLUMN valid_from date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE consent_record ADD COLUMN valid_to date;

-- 4. platform_connection: spec status default 'connected' (impl was 'active').
ALTER TABLE platform_connection ALTER COLUMN status SET DEFAULT 'connected';
-- Existing rows with the old default keep 'active' only if written; table is
-- empty (0 rows), so nothing to backfill. Column-level CHECK aligns too.
ALTER TABLE platform_connection ADD CONSTRAINT platform_connection_status_check
  CHECK (status IN ('active','connected','revoked'));

-- 5. job: spec state CHECK + max_attempts default 8 (L3.1 §8). The worker
--    legitimately uses 'failed' (DLQ view, L3.4 §3) so the CHECK includes it.
ALTER TABLE job ADD CONSTRAINT job_state_check
  CHECK (state IN ('ready','running','done','failed','dead'));
ALTER TABLE job ALTER COLUMN max_attempts SET DEFAULT 8;

-- 6. kill_switch: LBI-12 wants a durable kill-switch log; org_settings holds
--    the live flag, this table records every flip (auditable history).
CREATE TABLE IF NOT EXISTS kill_switch (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  scope      text NOT NULL DEFAULT 'org' CHECK (scope IN ('org','model')),
  model_id   uuid REFERENCES model_profile(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('enable','disable')),
  reason     text,
  actor_ref  text NOT NULL,
  created_at timestamp(3) with time zone NOT NULL DEFAULT now()
);
ALTER TABLE kill_switch ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_switch FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON kill_switch
  USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_kill_switch_org_ts ON kill_switch (org_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON kill_switch TO axiom_app;
GRANT ALL ON kill_switch TO axiom_migrator;

COMMIT;
