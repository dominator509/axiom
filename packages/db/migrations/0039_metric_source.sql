-- Never infer historical provenance from the presence of metric values.
ALTER TABLE post_metric ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'
    CHECK (source IN ('provider', 'manual', 'legacy'));
