-- Preserve future saved guideline values; do not invent lost historical edits.
CREATE TABLE playbook_guideline_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guideline_id UUID NOT NULL REFERENCES playbook_guideline(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  optimal_times JSONB NOT NULL,
  cadence_per_week INTEGER NOT NULL CHECK (cadence_per_week BETWEEN 0 AND 100),
  upsell_strategy TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guideline_id, revision)
);
CREATE INDEX playbook_revision_scope ON playbook_guideline_revision(org_id, model_id, platform, revision DESC);
ALTER TABLE playbook_guideline_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_guideline_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON playbook_guideline_revision
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
REVOKE ALL ON playbook_guideline_revision FROM PUBLIC;
GRANT SELECT, INSERT ON playbook_guideline_revision TO axiom_app;
GRANT ALL ON playbook_guideline_revision TO axiom_migrator;
