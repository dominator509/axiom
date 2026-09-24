-- Keep FanLynks API credentials separate from a provider's optional GA4 key.
BEGIN;

ALTER TABLE linkbio_provider
  ADD COLUMN IF NOT EXISTS fanlynks_token_enc BYTEA,
  ADD COLUMN IF NOT EXISTS fanlynks_token_nonce BYTEA,
  ADD COLUMN IF NOT EXISTS fanlynks_token_dek_id TEXT,
  ADD COLUMN IF NOT EXISTS fanlynks_analytics_status TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS fanlynks_last_synced_at TIMESTAMPTZ;

UPDATE linkbio_provider
  SET fanlynks_analytics_status = 'disconnected'
  WHERE fanlynks_token_enc IS NULL;

ALTER TABLE linkbio_provider
  ADD CONSTRAINT linkbio_provider_fanlynks_token_bundle
    CHECK (
      (fanlynks_token_enc IS NULL AND fanlynks_token_nonce IS NULL AND fanlynks_token_dek_id IS NULL)
      OR
      (fanlynks_token_enc IS NOT NULL AND fanlynks_token_nonce IS NOT NULL AND fanlynks_token_dek_id IS NOT NULL)
    ) NOT VALID;

ALTER TABLE linkbio_provider
  ADD CONSTRAINT linkbio_provider_fanlynks_analytics_status_check
    CHECK (fanlynks_analytics_status IN ('disconnected', 'configured', 'connected', 'sync_error')) NOT VALID;

COMMIT;
