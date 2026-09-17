ALTER TABLE variant_experiment_assignment ADD COLUMN review_bundle_id UUID
    REFERENCES content_bundle(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX variant_experiment_assignment_review_unique
    ON variant_experiment_assignment(review_bundle_id);
