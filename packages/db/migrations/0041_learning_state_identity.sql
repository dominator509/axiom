-- Leave historical/unattributed state intact; only the verified learning policy
-- uses this namespace and uniqueness contract.
CREATE UNIQUE INDEX bandit_state_verified_scope
ON bandit_state(org_id, model_id, platform, context, arm)
WHERE context LIKE 'learn-v1:%';
