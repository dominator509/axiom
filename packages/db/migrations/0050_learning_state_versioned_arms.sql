-- F-84: let the verified bandit identity include the learn-v2 namespace.
-- Existing learn-v1 rows remain intact and are not backfilled.
DROP INDEX IF EXISTS bandit_state_verified_scope;
CREATE UNIQUE INDEX bandit_state_verified_scope
  ON bandit_state(org_id, model_id, platform, context, arm)
  WHERE context LIKE 'learn-v%';
