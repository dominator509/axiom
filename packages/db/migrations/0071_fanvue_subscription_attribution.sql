-- F-23: Fanvue subscription tracking is delivered before its later payment.
BEGIN;

ALTER TABLE linkbio_attribution_event
  ADD COLUMN IF NOT EXISTS fanvue_connection_id UUID REFERENCES platform_connection(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fanvue_subscription_id TEXT;
CREATE INDEX IF NOT EXISTS linkbio_attribution_fanvue_subscription
  ON linkbio_attribution_event(org_id, model_id, fanvue_connection_id, fanvue_subscription_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'linkbio_attribution_fanvue_subscription_check'
      AND conrelid = 'linkbio_attribution_event'::regclass) THEN
    ALTER TABLE linkbio_attribution_event ADD CONSTRAINT linkbio_attribution_fanvue_subscription_check
      CHECK (fanvue_subscription_id IS NULL OR length(fanvue_subscription_id) BETWEEN 1 AND 240);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fanvue_subscription_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  short_link_id UUID REFERENCES short_link(id) ON DELETE SET NULL,
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_event_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fanvue_subscription_attribution_connection_id_unique UNIQUE (connection_id, subscription_id),
  CONSTRAINT fanvue_subscription_attribution_subscription_check CHECK (length(subscription_id) BETWEEN 1 AND 240),
  CONSTRAINT fanvue_subscription_attribution_utm_object CHECK (jsonb_typeof(utm) = 'object')
);
CREATE INDEX IF NOT EXISTS fanvue_subscription_attribution_scope
  ON fanvue_subscription_attribution(org_id, model_id, connection_id, updated_at DESC);
ALTER TABLE fanvue_subscription_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanvue_subscription_attribution FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON fanvue_subscription_attribution
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
REVOKE ALL ON fanvue_subscription_attribution FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON fanvue_subscription_attribution TO axiom_app, axiom;
GRANT ALL ON fanvue_subscription_attribution TO axiom_migrator;

COMMIT;
