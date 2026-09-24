-- Preserve normalized connector-declared performance fields for F-79.
-- The hypertable keeps its existing time-partitioned key and RLS policy.
BEGIN;

ALTER TABLE post_metric
  ADD COLUMN IF NOT EXISTS provider_metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_metric_provider_metrics_object'
      AND conrelid = 'post_metric'::regclass
  ) THEN
    ALTER TABLE post_metric
      ADD CONSTRAINT post_metric_provider_metrics_object
      CHECK (jsonb_typeof(provider_metrics) = 'object');
  END IF;
END $$;

COMMIT;
