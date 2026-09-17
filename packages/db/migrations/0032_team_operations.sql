-- Human operations: model-scoped shifts/DM queue assignments and internal notes.
CREATE TABLE IF NOT EXISTS team_shift (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id          UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    assignee_user_id  TEXT NOT NULL,
    queue             TEXT NOT NULL DEFAULT 'inbox',
    starts_at         TIMESTAMPTZ NOT NULL,
    ends_at           TIMESTAMPTZ NOT NULL,
    status            TEXT NOT NULL DEFAULT 'scheduled',
    note              TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT team_shift_time_order CHECK (ends_at > starts_at),
    CONSTRAINT team_shift_status_check CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS team_note (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id      UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    author_user_id TEXT NOT NULL,
    target_type   TEXT NOT NULL DEFAULT 'model',
    target_id     TEXT,
    body          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_shift_model_time ON team_shift(org_id, model_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_team_note_model_created ON team_note(org_id, model_id, created_at DESC);

ALTER TABLE team_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_shift FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON team_shift USING (org_id = current_setting('app.current_org_id')::uuid) WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
ALTER TABLE team_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_note FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON team_note USING (org_id = current_setting('app.current_org_id')::uuid) WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON team_shift, team_note FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_shift, team_note TO axiom_app;
GRANT ALL ON team_shift, team_note TO axiom_migrator;
