-- Keep generation-time selection separate from post-hoc observed structure.
-- Existing bundles have no recorded selection; do not backfill invented evidence.
ALTER TABLE content_bundle ADD COLUMN caption_guidance jsonb NOT NULL DEFAULT '{}';
ALTER TABLE content_bundle ADD CONSTRAINT content_bundle_caption_guidance_object
    CHECK (jsonb_typeof(caption_guidance) = 'object');
