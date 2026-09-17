-- Editable model playbook inputs used by scheduler/generation S1 context.
CREATE TABLE IF NOT EXISTS playbook_guideline (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL,
    optimal_times    JSONB NOT NULL DEFAULT '[]'::jsonb,
    cadence_per_week INTEGER NOT NULL DEFAULT 3 CHECK (cadence_per_week BETWEEN 0 AND 100),
    upsell_strategy  TEXT NOT NULL DEFAULT '',
    revision         INTEGER NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT playbook_guideline_model_platform_unique UNIQUE (model_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_playbook_guideline_model ON playbook_guideline(org_id, model_id, platform);

ALTER TABLE playbook_guideline ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_guideline FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON playbook_guideline USING (org_id = current_setting('app.current_org_id')::uuid) WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON playbook_guideline FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON playbook_guideline TO axiom_app;
GRANT ALL ON playbook_guideline TO axiom_migrator;
