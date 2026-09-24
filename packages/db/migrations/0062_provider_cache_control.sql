-- AXIOM migration 0062 — model-scoped provider cache controls (F-33).
-- This stores only bounded preferences. It never stores provider credentials,
-- prompts, request bodies, or upstream responses.

BEGIN;

CREATE TABLE IF NOT EXISTS provider_cache_control (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id          UUID        NOT NULL,
    provider          TEXT        NOT NULL,
    enabled           BOOLEAN     NOT NULL DEFAULT false,
    prefix_alignment  BOOLEAN     NOT NULL DEFAULT false,
    prompt_cache_key  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT provider_cache_control_provider_closed
        CHECK (provider IN ('deepseek', 'anthropic', 'openai')),
    CONSTRAINT provider_cache_control_key_bounded
        CHECK (prompt_cache_key IS NULL
               OR prompt_cache_key ~ '^[A-Za-z0-9._:-]{1,64}$'),
    CONSTRAINT provider_cache_control_model_fk
        FOREIGN KEY (org_id, model_id) REFERENCES model_profile (org_id, id) ON DELETE CASCADE,
    CONSTRAINT provider_cache_control_identity
        UNIQUE (org_id, model_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_provider_cache_control_org_model
    ON provider_cache_control(org_id, model_id);

ALTER TABLE provider_cache_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_cache_control FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON provider_cache_control
    USING (org_id = current_setting('app.current_org_id')::uuid);

-- The application role owns runtime CRUD. The migration role needs DDL rights
-- only while applying migrations; there is deliberately no blanket/undefined
-- role grant here.
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_cache_control TO axiom_app;
GRANT ALL PRIVILEGES ON provider_cache_control TO axiom_migrator;

COMMIT;
