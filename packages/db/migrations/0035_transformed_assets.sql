-- Keep original lineage while making transformed bytes available to the media library.
-- Existing variants remain unlinked; never invent verified metadata for legacy files.
ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_origin_allowed;
ALTER TABLE asset ADD CONSTRAINT asset_origin_allowed
  CHECK (origin IN ('uploaded', 'generated', 'transformed', 'legacy'));
ALTER TABLE asset_variant ADD COLUMN output_asset_id UUID REFERENCES asset(id) ON DELETE RESTRICT;
CREATE INDEX idx_asset_variant_output ON asset_variant(output_asset_id);
