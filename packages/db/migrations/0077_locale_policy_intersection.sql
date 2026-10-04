-- Keep the user-write constraint in addition to tenant isolation. Permissive
-- policies combine with OR; the original second INSERT policy could therefore
-- admit a row that org_isolation rejected. Preserve the historical checksum
-- and correct only this policy's composition in a new migration.
BEGIN;

DROP POLICY ui_locale_preference_user_self_write ON ui_locale_preference;
CREATE POLICY ui_locale_preference_user_self_write ON ui_locale_preference
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    scope = 'org'
    OR (scope = 'user' AND user_id = current_setting('app.current_user_id', true))
  );

COMMIT;
