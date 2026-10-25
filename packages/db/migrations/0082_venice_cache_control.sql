-- Enable the documented Venice routing hint in existing model-scoped controls.
-- No settings are enabled or populated by this migration. RLS, the composite
-- tenant/model foreign key, key bounds, grants and uniqueness remain intact.
BEGIN;

ALTER TABLE provider_cache_control
    DROP CONSTRAINT provider_cache_control_provider_closed;
ALTER TABLE provider_cache_control
    ADD CONSTRAINT provider_cache_control_provider_closed
    CHECK (provider IN ('deepseek', 'anthropic', 'openai', 'venice'));

COMMIT;
