-- Durable A/B variant experiments. Assignments are stable per experiment and
-- hashed caller key; this records outcomes without creating a publish path.
CREATE TABLE IF NOT EXISTS variant_experiment (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id           UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    platform           TEXT NOT NULL,
    variant_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
    status             TEXT NOT NULL DEFAULT 'draft',
    winner_variant_id  UUID REFERENCES asset_variant(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT variant_experiment_status_check CHECK (status IN ('draft', 'running', 'paused', 'completed')),
    CONSTRAINT variant_experiment_model_name_unique UNIQUE (model_id, name)
);

CREATE TABLE IF NOT EXISTS variant_experiment_assignment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    experiment_id   UUID NOT NULL REFERENCES variant_experiment(id) ON DELETE CASCADE,
    variant_id      UUID NOT NULL REFERENCES asset_variant(id) ON DELETE CASCADE,
    assignment_key  TEXT NOT NULL,
    converted       BOOLEAN NOT NULL DEFAULT false,
    metric_value    DOUBLE PRECISION,
    outcome_at      TIMESTAMPTZ,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT variant_experiment_assignment_key_unique UNIQUE (experiment_id, assignment_key)
);

CREATE INDEX IF NOT EXISTS idx_variant_experiment_model ON variant_experiment(org_id, model_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_variant_experiment_assignment_experiment ON variant_experiment_assignment(org_id, experiment_id, assigned_at DESC);

ALTER TABLE variant_experiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_experiment FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON variant_experiment
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
ALTER TABLE variant_experiment_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_experiment_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON variant_experiment_assignment
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON variant_experiment, variant_experiment_assignment FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON variant_experiment, variant_experiment_assignment TO axiom_app;
GRANT ALL ON variant_experiment, variant_experiment_assignment TO axiom_migrator;
