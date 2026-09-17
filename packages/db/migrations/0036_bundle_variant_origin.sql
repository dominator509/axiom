-- Preserve reviewed variant identity without attributing edited copy to it.
ALTER TABLE content_bundle ADD COLUMN source_variant_id UUID
    REFERENCES asset_variant(id) ON DELETE RESTRICT;
CREATE INDEX content_bundle_source_variant_idx ON content_bundle(source_variant_id)
    WHERE source_variant_id IS NOT NULL;
