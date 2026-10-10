-- Provider-reported daily cache metrics for TOKENKILLER acceptance.
-- No prompts, completions, credentials, or raw provider payloads are stored.

BEGIN;

CREATE TABLE IF NOT EXISTS provider_cache_observation (
    id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                        UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id                      UUID        NOT NULL,
    provider                      TEXT        NOT NULL,
    observed_on                   DATE        NOT NULL,
    observed_responses            INTEGER     NOT NULL DEFAULT 0,
    unobserved_responses          INTEGER     NOT NULL DEFAULT 0,
    prompt_tokens                 BIGINT      NOT NULL DEFAULT 0,
    cached_prompt_tokens          BIGINT      NOT NULL DEFAULT 0,
    cache_creation_prompt_tokens  BIGINT      NOT NULL DEFAULT 0,
    last_observed_at              TIMESTAMPTZ NOT NULL,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT provider_cache_observation_provider_bounded
        CHECK (provider ~ '^[a-z0-9_-]{1,64}$'),
    CONSTRAINT provider_cache_observation_counts_nonnegative
        CHECK (observed_responses >= 0
               AND unobserved_responses >= 0
               AND prompt_tokens >= 0
               AND cached_prompt_tokens >= 0
               AND cache_creation_prompt_tokens >= 0
               AND cached_prompt_tokens + cache_creation_prompt_tokens <= prompt_tokens),
    CONSTRAINT provider_cache_observation_model_fk
        FOREIGN KEY (org_id, model_id) REFERENCES model_profile (org_id, id) ON DELETE CASCADE,
    CONSTRAINT provider_cache_observation_identity
        UNIQUE (org_id, model_id, provider, observed_on)
);

CREATE INDEX IF NOT EXISTS idx_provider_cache_observation_org_model_day
    ON provider_cache_observation(org_id, model_id, observed_on);

ALTER TABLE provider_cache_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_cache_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON provider_cache_observation
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON provider_cache_observation TO axiom_app;
GRANT ALL PRIVILEGES ON provider_cache_observation TO axiom_migrator;

COMMIT;
