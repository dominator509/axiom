-- Preserve the exact existing photoshoot controls for immutable publication
-- evidence. Historical bundles remain NULL because their controls were never
-- persisted; no values are inferred from editable prompts or captions.
ALTER TABLE content_bundle
  ADD COLUMN IF NOT EXISTS generation_recipe JSONB;
