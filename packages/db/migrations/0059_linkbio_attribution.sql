-- AXIOM migration 0059 — first-party link-bio revenue attribution (F-23)
-- Source-only contract: this migration is authored but must be applied only by
-- the controlled migration path after the normal rehearsal and owner approval.

BEGIN;

ALTER TABLE linkbio_click
  ADD COLUMN IF NOT EXISTS short_link_id UUID REFERENCES short_link(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS linkbio_attribution_event (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id       UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    short_link_id  UUID REFERENCES short_link(id) ON DELETE SET NULL,
    source         TEXT NOT NULL DEFAULT 'fanvue',
    event_key      TEXT NOT NULL,
    kind           TEXT NOT NULL,
    amount_cents   INTEGER NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'USD',
    utm            JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at    TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT linkbio_attribution_event_source_key_unique UNIQUE (org_id, source, event_key),
    CONSTRAINT linkbio_attribution_event_source_check CHECK (source IN ('fanvue')),
    CONSTRAINT linkbio_attribution_event_kind_check CHECK (kind IN ('subscription', 'ppv_purchase', 'subscription_refund')),
    CONSTRAINT linkbio_attribution_event_amount_check CHECK (amount_cents >= 0),
    CONSTRAINT linkbio_attribution_event_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

ALTER TABLE linkbio_attribution_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkbio_attribution_event FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'linkbio_attribution_event'::regclass
      AND polname = 'org_isolation'
  ) THEN
    CREATE POLICY org_isolation ON linkbio_attribution_event
      USING (org_id = current_setting('app.current_org_id')::uuid);
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON linkbio_attribution_event TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkbio_attribution_event TO axiom;

CREATE INDEX IF NOT EXISTS idx_linkbio_attribution_event_model_time
  ON linkbio_attribution_event(org_id, model_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkbio_attribution_event_short_link_time
  ON linkbio_attribution_event(short_link_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkbio_click_short_link_time
  ON linkbio_click(short_link_id, ts DESC);

COMMIT;
