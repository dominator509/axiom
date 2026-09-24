-- Link-in-bio provider lifecycle, encrypted analytics credentials, and normalized imports.
BEGIN;

ALTER TABLE linkbio_provider
  ADD COLUMN IF NOT EXISTS profile_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'configured',
  ADD COLUMN IF NOT EXISTS credentials_enc BYTEA,
  ADD COLUMN IF NOT EXISTS credentials_nonce BYTEA,
  ADD COLUMN IF NOT EXISTS credentials_dek_id TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

ALTER TABLE linkbio_provider
  ADD CONSTRAINT linkbio_provider_status_check
    CHECK (status IN ('configured', 'connected', 'sync_error', 'disabled')) NOT VALID;

ALTER TABLE linkbio_analytics
  ADD COLUMN IF NOT EXISTS target TEXT,
  ADD COLUMN IF NOT EXISTS external_event_id TEXT,
  ADD COLUMN IF NOT EXISTS visits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_visitors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversions INTEGER NOT NULL DEFAULT 0;

ALTER TABLE linkbio_analytics
  ADD CONSTRAINT linkbio_analytics_counts_nonnegative
    CHECK (visits >= 0 AND unique_visitors >= 0 AND clicks >= 0 AND conversions >= 0) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_linkbio_analytics_provider_external_event
  ON linkbio_analytics (provider_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_linkbio_analytics_org_provider_ts
  ON linkbio_analytics (org_id, provider_id, ts DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON linkbio_provider TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkbio_analytics TO axiom_app;

COMMIT;
