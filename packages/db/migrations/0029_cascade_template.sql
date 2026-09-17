-- Persisted cross-platform cascade schedules (F-11). Expansion creates normal
-- post_target rows and publish.target jobs; no connector bypass is introduced.
CREATE TABLE IF NOT EXISTS cascade_template (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id   UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    steps      JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cascade_template_model_id ON cascade_template(model_id);
CREATE INDEX IF NOT EXISTS idx_cascade_template_org_id ON cascade_template(org_id);

ALTER TABLE cascade_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_template FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON cascade_template
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON cascade_template FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON cascade_template TO axiom_app;
GRANT ALL ON cascade_template TO axiom_migrator;
