-- F-89: persisted UI locale preference (user explicit choice + organization default).
--
-- UI locale is deliberately a separate field from any content/model locale:
-- this table never stores or implies a translation of authored content.

CREATE TABLE IF NOT EXISTS ui_locale_preference (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL CHECK (scope IN ('user', 'org')),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  user_id     text REFERENCES auth_user(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ui_locale_preference_scope_owner CHECK (
    (scope = 'user' AND user_id IS NOT NULL)
    OR (scope = 'org' AND user_id IS NULL)
  ),
  CONSTRAINT ui_locale_preference_locale_supported CHECK (
    locale IN ('en', 'es', 'ja', 'it', 'pt-BR', 'de')
  )
);

-- One explicit choice per user, one default per organization.
CREATE UNIQUE INDEX IF NOT EXISTS ui_locale_preference_user_unique
  ON ui_locale_preference (org_id, user_id)
  WHERE scope = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS ui_locale_preference_org_unique
  ON ui_locale_preference (org_id)
  WHERE scope = 'org';

ALTER TABLE ui_locale_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE ui_locale_preference FORCE ROW LEVEL SECURITY;

-- Tenant isolation: a row is visible only within its own organization.
DROP POLICY IF EXISTS org_isolation ON ui_locale_preference;
CREATE POLICY org_isolation ON ui_locale_preference
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

-- A user may only write their own explicit preference; the org default is
-- written through the operator path.
DROP POLICY IF EXISTS ui_locale_preference_user_self_write ON ui_locale_preference;
CREATE POLICY ui_locale_preference_user_self_write ON ui_locale_preference
  FOR INSERT
  WITH CHECK (
    scope = 'org'
    OR (scope = 'user' AND user_id = current_setting('app.current_user_id', true))
  );

REVOKE ALL ON ui_locale_preference FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON ui_locale_preference TO axiom_app;
GRANT ALL ON ui_locale_preference TO axiom_migrator;
