-- F-91: Patreon v2 read/sync/event-only integration.
-- Patreon never enters publish_target resolution. Provider payloads are
-- normalized into tenant/model/connection-scoped rows and webhook bodies are
-- reduced to an event id, type and digest.

CREATE TABLE IF NOT EXISTS patreon_campaign (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id              UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id         UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  provider_campaign_id  TEXT NOT NULL,
  creator_provider_id   TEXT NOT NULL,
  name                  TEXT NOT NULL DEFAULT '',
  provider_created_at   TEXT,
  provider_published_at TEXT,
  patron_count          INTEGER,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patreon_campaign_connection_provider_unique UNIQUE (connection_id, provider_campaign_id)
);
CREATE INDEX IF NOT EXISTS patreon_campaign_scope_lookup
  ON patreon_campaign(org_id, model_id, connection_id);

CREATE TABLE IF NOT EXISTS patreon_membership (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id                        UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id                   UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  provider_member_id              TEXT NOT NULL,
  provider_campaign_id            TEXT NOT NULL,
  tier_id                         TEXT,
  tier_title                      TEXT,
  status                          TEXT NOT NULL CHECK (status IN ('active_patron','declined_patron','former_patron','pending')),
  currently_entitled_amount_cents INTEGER,
  last_charge_status              TEXT,
  synced_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patreon_membership_connection_provider_unique UNIQUE (connection_id, provider_member_id)
);
CREATE INDEX IF NOT EXISTS patreon_membership_scope_campaign
  ON patreon_membership(org_id, model_id, connection_id, provider_campaign_id);

CREATE TABLE IF NOT EXISTS patreon_post (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id              UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id         UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  provider_post_id      TEXT NOT NULL,
  provider_campaign_id  TEXT NOT NULL,
  title                 TEXT NOT NULL DEFAULT '',
  is_public             BOOLEAN NOT NULL DEFAULT false,
  provider_published_at TEXT,
  provider_url          TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patreon_post_connection_provider_unique UNIQUE (connection_id, provider_post_id)
);
CREATE INDEX IF NOT EXISTS patreon_post_scope_campaign
  ON patreon_post(org_id, model_id, connection_id, provider_campaign_id);

CREATE TABLE IF NOT EXISTS patreon_sync_state (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id     UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  resource     TEXT NOT NULL CHECK (resource IN ('campaign','members','posts')),
  last_cursor  TEXT,
  next_cursor  TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patreon_sync_state_connection_resource_unique UNIQUE (connection_id, resource)
);
CREATE INDEX IF NOT EXISTS patreon_sync_state_scope_lookup
  ON patreon_sync_state(org_id, model_id, connection_id);

CREATE TABLE IF NOT EXISTS patreon_webhook_event (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id           UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id      UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  provider_event_id  TEXT NOT NULL,
  event_type         TEXT NOT NULL DEFAULT 'unknown',
  occurred_at        TIMESTAMPTZ NOT NULL,
  payload_digest     TEXT NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patreon_webhook_connection_event_unique UNIQUE (connection_id, provider_event_id)
);
CREATE INDEX IF NOT EXISTS patreon_webhook_scope_time
  ON patreon_webhook_event(org_id, model_id, connection_id, received_at);

ALTER TABLE patreon_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE patreon_campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON patreon_campaign
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
REVOKE ALL ON patreon_campaign FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patreon_campaign TO axiom_app;
GRANT ALL ON patreon_campaign TO axiom_migrator;

ALTER TABLE patreon_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE patreon_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON patreon_membership
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
REVOKE ALL ON patreon_membership FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patreon_membership TO axiom_app;
GRANT ALL ON patreon_membership TO axiom_migrator;

ALTER TABLE patreon_post ENABLE ROW LEVEL SECURITY;
ALTER TABLE patreon_post FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON patreon_post
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
REVOKE ALL ON patreon_post FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patreon_post TO axiom_app;
GRANT ALL ON patreon_post TO axiom_migrator;

ALTER TABLE patreon_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE patreon_sync_state FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON patreon_sync_state
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
REVOKE ALL ON patreon_sync_state FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patreon_sync_state TO axiom_app;
GRANT ALL ON patreon_sync_state TO axiom_migrator;

ALTER TABLE patreon_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE patreon_webhook_event FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON patreon_webhook_event
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
REVOKE ALL ON patreon_webhook_event FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patreon_webhook_event TO axiom_app;
GRANT ALL ON patreon_webhook_event TO axiom_migrator;
