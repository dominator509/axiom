ALTER TABLE asset
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'legacy';

ALTER TABLE asset
  ADD CONSTRAINT asset_origin_allowed CHECK (origin IN ('uploaded', 'generated', 'legacy'));
