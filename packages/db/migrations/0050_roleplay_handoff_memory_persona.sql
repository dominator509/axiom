-- Actor-agnostic Chatter state. Human shifts remain valid; an LLM shift is
-- still a team_shift row and must also have an org/model agent_permission.
ALTER TABLE team_shift ADD COLUMN IF NOT EXISTS assignee_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE team_shift ADD COLUMN IF NOT EXISTS assignee_agent_ref TEXT;
ALTER TABLE team_shift ALTER COLUMN assignee_user_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_shift_actor_shape') THEN
    ALTER TABLE team_shift ADD CONSTRAINT team_shift_actor_shape CHECK (
      (assignee_type = 'human' AND assignee_user_id IS NOT NULL AND assignee_agent_ref IS NULL)
      OR (assignee_type = 'llm' AND assignee_user_id IS NULL AND assignee_agent_ref IS NOT NULL)
    );
  END IF;
END $$;
ALTER TABLE team_shift ADD CONSTRAINT team_shift_assignee_type_check CHECK (assignee_type IN ('human', 'llm'));
CREATE INDEX IF NOT EXISTS idx_team_shift_actor ON team_shift(org_id, model_id, assignee_type, assignee_agent_ref, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS roleplay_persona_revision (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id           UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    source             TEXT NOT NULL CHECK (source IN ('model_profile', 'playbook', 'soul.md')),
    revision           INTEGER NOT NULL CHECK (revision > 0),
    source_ref         TEXT NOT NULL CHECK (source_ref ~ '^(soul\.md)(:[A-Za-z0-9._-]{1,128})?(:r[1-9][0-9]*)?$'),
    content            TEXT NOT NULL CHECK (char_length(btrim(content)) > 0 AND char_length(content) <= 8000),
    created_by_user_id TEXT NOT NULL REFERENCES auth_user(id),
    created_at         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT roleplay_persona_scope_revision UNIQUE (org_id, model_id, source, revision)
);
CREATE INDEX IF NOT EXISTS roleplay_persona_latest ON roleplay_persona_revision(org_id, model_id, source, revision DESC);

CREATE TABLE IF NOT EXISTS roleplay_memory_turn (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id        UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    conversation_key TEXT NOT NULL CHECK (conversation_key ~ '^[A-Za-z0-9._-]{1,128}$'),
    sequence        INTEGER NOT NULL CHECK (sequence > 0),
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    speaker_type    TEXT NOT NULL CHECK (speaker_type IN ('human', 'llm')),
    speaker_ref     TEXT NOT NULL,
    content         TEXT NOT NULL CHECK (char_length(btrim(content)) > 0 AND char_length(content) <= 4000),
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT roleplay_memory_scope_sequence UNIQUE (org_id, model_id, conversation_key, sequence)
);
CREATE INDEX IF NOT EXISTS roleplay_memory_tail ON roleplay_memory_turn(org_id, model_id, conversation_key, sequence DESC);

CREATE TABLE IF NOT EXISTS roleplay_handoff (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id        UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    conversation_key TEXT NOT NULL CHECK (conversation_key ~ '^[A-Za-z0-9._-]{1,128}$'),
    actor_type      TEXT NOT NULL CHECK (actor_type IN ('human', 'llm')),
    actor_ref       TEXT NOT NULL,
    shift_id        UUID NOT NULL REFERENCES team_shift(id),
    revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    payload         JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT roleplay_handoff_scope_conversation UNIQUE (org_id, model_id, conversation_key)
);
CREATE INDEX IF NOT EXISTS roleplay_handoff_actor ON roleplay_handoff(org_id, model_id, actor_type, actor_ref);

ALTER TABLE roleplay_persona_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_persona_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON roleplay_persona_revision
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
ALTER TABLE roleplay_memory_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_memory_turn FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON roleplay_memory_turn
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
ALTER TABLE roleplay_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_handoff FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON roleplay_handoff
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON roleplay_persona_revision, roleplay_memory_turn, roleplay_handoff FROM PUBLIC;
GRANT SELECT, INSERT ON roleplay_persona_revision TO axiom_app;
GRANT SELECT, INSERT, DELETE ON roleplay_memory_turn TO axiom_app;
GRANT SELECT, INSERT, UPDATE ON roleplay_handoff TO axiom_app;
GRANT ALL ON roleplay_persona_revision, roleplay_memory_turn, roleplay_handoff TO axiom_migrator;
