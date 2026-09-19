-- Durable authenticated scraper orchestration. Raw results remain tenant
-- scoped and are never presented as provider metrics automatically.
CREATE TABLE IF NOT EXISTS scrape_run (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id      UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('social', 'competitor')),
    request       JSONB NOT NULL DEFAULT '{}'::jsonb,
    result        JSONB,
    state         TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed')),
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scrape_run_model_created ON scrape_run(org_id, model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_run_state ON scrape_run(org_id, state, created_at DESC);

ALTER TABLE scrape_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_run FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON scrape_run
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON scrape_run FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON scrape_run TO axiom_app;
GRANT ALL ON scrape_run TO axiom_migrator;
