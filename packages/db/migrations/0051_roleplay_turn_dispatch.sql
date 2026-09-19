-- Durable provider-turn fence for the human/LLM Chatter roleplay surface.
-- This is roleplay state, not a second inbox and never a publication grant.
CREATE TABLE IF NOT EXISTS roleplay_turn (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id            UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    conversation_key    TEXT NOT NULL CHECK (conversation_key ~ '^[A-Za-z0-9._-]{1,128}$'),
    intent_key          UUID NOT NULL,
    actor_type          TEXT NOT NULL CHECK (actor_type IN ('human', 'llm')),
    actor_ref           TEXT NOT NULL,
    shift_id            UUID NOT NULL REFERENCES team_shift(id),
    provider            TEXT NOT NULL DEFAULT 'grok' CHECK (provider IN ('grok')),
    provider_model     TEXT NOT NULL CHECK (char_length(btrim(provider_model)) > 0 AND char_length(provider_model) <= 128),
    persona_revision    INTEGER,
    input               TEXT NOT NULL CHECK (char_length(btrim(input)) > 0 AND char_length(input) <= 4000),
    output              TEXT CHECK (output IS NULL OR char_length(output) <= 8000),
    state               TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'uncertain', 'rejected')),
    provider_request_id TEXT,
    provider_status     INTEGER,
    error_code          TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9._-]{1,64}$'),
    created_at          TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    finalized_at        TIMESTAMPTZ(3),
    CONSTRAINT roleplay_turn_scope_intent UNIQUE (org_id, model_id, intent_key)
);
CREATE INDEX IF NOT EXISTS roleplay_turn_conversation ON roleplay_turn(org_id, model_id, conversation_key, created_at, id);

ALTER TABLE roleplay_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_turn FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON roleplay_turn
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON roleplay_turn FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON roleplay_turn TO axiom_app;
GRANT ALL ON roleplay_turn TO axiom_migrator;
