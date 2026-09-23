-- F-21: model-scoped keyword moderation rules and redacted action receipts.
BEGIN;

CREATE TABLE IF NOT EXISTS comment_moderation_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  keywords JSONB NOT NULL,
  action TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comment_moderation_rule_identity_unique UNIQUE (org_id, model_id, platform, name),
  CONSTRAINT comment_moderation_rule_action_check CHECK (action IN ('hide', 'hide_and_block')),
  CONSTRAINT comment_moderation_rule_name_length CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT comment_moderation_rule_platform_length CHECK (length(platform) BETWEEN 1 AND 50),
  CONSTRAINT comment_moderation_rule_keywords_array_check CHECK (jsonb_typeof(keywords) = 'array' AND jsonb_array_length(keywords) BETWEEN 1 AND 24)
);
CREATE INDEX IF NOT EXISTS comment_moderation_rule_scope_enabled
  ON comment_moderation_rule(org_id, model_id, platform, enabled);
ALTER TABLE comment_moderation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_moderation_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comment_moderation_rule
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
REVOKE ALL ON comment_moderation_rule FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON comment_moderation_rule TO axiom_app, axiom;
GRANT ALL ON comment_moderation_rule TO axiom_migrator;

CREATE TABLE IF NOT EXISTS comment_moderation_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES platform_connection(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES comment_moderation_rule(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  provider_comment_id TEXT NOT NULL,
  matched_keyword_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT comment_moderation_action_identity_unique UNIQUE (connection_id, rule_id, provider_comment_id),
  CONSTRAINT comment_moderation_action_status_check CHECK (status IN ('pending', 'applied', 'partial', 'unknown', 'unsupported')),
  CONSTRAINT comment_moderation_action_keyword_count_check CHECK (matched_keyword_count BETWEEN 1 AND 24),
  CONSTRAINT comment_moderation_action_comment_id_check CHECK (length(provider_comment_id) BETWEEN 1 AND 256),
  CONSTRAINT comment_moderation_action_post_id_check CHECK (length(post_id) BETWEEN 1 AND 256)
);
CREATE INDEX IF NOT EXISTS comment_moderation_action_scope_time
  ON comment_moderation_action(org_id, model_id, created_at DESC);
ALTER TABLE comment_moderation_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_moderation_action FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON comment_moderation_action
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
REVOKE ALL ON comment_moderation_action FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON comment_moderation_action TO axiom_app, axiom;
GRANT ALL ON comment_moderation_action TO axiom_migrator;

COMMIT;
