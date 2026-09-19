-- Historical recipes have no proven target attribution; retain them unchanged.
ALTER TABLE viral_recipe ADD COLUMN source_target_id UUID REFERENCES post_target(id) ON DELETE RESTRICT;
ALTER TABLE viral_recipe ADD CONSTRAINT viral_recipe_source_target_unique UNIQUE (source_target_id);
