-- Assignments do not activate roles or grant access by themselves. API policy
-- must additionally authorize the operation (and active shift for chatters).
ALTER TABLE auth_user ADD CONSTRAINT auth_user_org_identity UNIQUE (org_id, id);
ALTER TABLE model_profile ADD CONSTRAINT model_profile_org_identity UNIQUE (org_id, id);

CREATE TABLE IF NOT EXISTS model_user_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT model_user_assignment_identity UNIQUE (org_id, model_id, user_id),
  CONSTRAINT model_user_assignment_model FOREIGN KEY (org_id, model_id)
    REFERENCES model_profile(org_id, id) ON DELETE CASCADE,
  CONSTRAINT model_user_assignment_user FOREIGN KEY (org_id, user_id)
    REFERENCES auth_user(org_id, id) ON DELETE CASCADE
);
CREATE INDEX model_user_assignment_user_scope ON model_user_assignment(org_id, user_id, model_id);
ALTER TABLE model_user_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_user_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON model_user_assignment
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
REVOKE ALL ON model_user_assignment FROM PUBLIC;
-- An assignment is granted or revoked, never silently retargeted.
GRANT SELECT, INSERT, DELETE ON model_user_assignment TO axiom_app;
GRANT ALL ON model_user_assignment TO axiom_migrator;
