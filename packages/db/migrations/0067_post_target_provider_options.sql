ALTER TABLE post_target
  ADD COLUMN provider_options jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE post_target
  ADD CONSTRAINT post_target_provider_options_object
  CHECK (jsonb_typeof(provider_options) = 'object');
