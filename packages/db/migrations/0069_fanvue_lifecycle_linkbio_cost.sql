-- F-20 / F-23: signed Fanvue event receipts, reviewed churn actions and real campaign spend.
BEGIN;

CREATE TABLE IF NOT EXISTS fanvue_webhook_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_digest TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fanvue_webhook_connection_event_unique UNIQUE (connection_id, provider_event_id),
  CONSTRAINT fanvue_webhook_id_scope_unique UNIQUE (id, org_id, model_id, connection_id),
  CONSTRAINT fanvue_webhook_event_id_length CHECK (length(provider_event_id) BETWEEN 1 AND 240),
  CONSTRAINT fanvue_webhook_event_type_length CHECK (length(event_type) BETWEEN 1 AND 120),
  CONSTRAINT fanvue_webhook_digest_check CHECK (payload_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS fanvue_webhook_scope_time
  ON fanvue_webhook_event(org_id, model_id, connection_id, received_at DESC);
ALTER TABLE fanvue_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanvue_webhook_event FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON fanvue_webhook_event
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
REVOKE ALL ON fanvue_webhook_event FROM PUBLIC;
GRANT SELECT, INSERT ON fanvue_webhook_event TO axiom_app, axiom;
GRANT ALL ON fanvue_webhook_event TO axiom_migrator;

CREATE TABLE IF NOT EXISTS fanvue_churn_rescue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  webhook_event_id UUID NOT NULL,
  provider_event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  recipient_uuid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  attempted_by_user_id TEXT,
  attempt_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  remote_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fanvue_churn_rescue_event_scope_fk FOREIGN KEY (webhook_event_id, org_id, model_id, connection_id)
    REFERENCES fanvue_webhook_event(id, org_id, model_id, connection_id) ON DELETE CASCADE,
  CONSTRAINT fanvue_churn_rescue_subscription_unique UNIQUE (connection_id, subscription_id),
  CONSTRAINT fanvue_churn_rescue_status_check CHECK (status IN ('ready', 'sending', 'sent', 'unknown', 'failed', 'dismissed')),
  CONSTRAINT fanvue_churn_rescue_recipient_uuid_check CHECK (recipient_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT fanvue_churn_rescue_subscription_id_check CHECK (length(subscription_id) BETWEEN 1 AND 240)
);
CREATE INDEX IF NOT EXISTS fanvue_churn_rescue_scope_status
  ON fanvue_churn_rescue(org_id, model_id, status, created_at DESC);
ALTER TABLE fanvue_churn_rescue ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanvue_churn_rescue FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON fanvue_churn_rescue
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
REVOKE ALL ON fanvue_churn_rescue FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON fanvue_churn_rescue TO axiom_app, axiom;
GRANT ALL ON fanvue_churn_rescue TO axiom_migrator;

CREATE TABLE IF NOT EXISTS linkbio_campaign_cost (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  short_link_id UUID NOT NULL REFERENCES short_link(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT linkbio_campaign_cost_key_unique UNIQUE (org_id, event_key),
  CONSTRAINT linkbio_campaign_cost_key_length CHECK (length(event_key) BETWEEN 1 AND 240),
  CONSTRAINT linkbio_campaign_cost_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT linkbio_campaign_cost_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE INDEX IF NOT EXISTS linkbio_campaign_cost_model_time
  ON linkbio_campaign_cost(org_id, model_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS linkbio_campaign_cost_link_time
  ON linkbio_campaign_cost(short_link_id, occurred_at DESC);
ALTER TABLE linkbio_campaign_cost ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkbio_campaign_cost FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON linkbio_campaign_cost
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
REVOKE ALL ON linkbio_campaign_cost FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkbio_campaign_cost TO axiom_app, axiom;
GRANT ALL ON linkbio_campaign_cost TO axiom_migrator;

COMMIT;
