-- Durable operator-requested media transforms. Results are asset variants and
-- still require the normal ToS/approval path before publication.
CREATE TABLE IF NOT EXISTS media_operation (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    source_asset_id  UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    result_variant_id UUID REFERENCES asset_variant(id) ON DELETE SET NULL,
    type             TEXT NOT NULL CHECK (type IN ('image_clip', 'image_resize', 'video_clip', 'video_transcode')),
    options          JSONB NOT NULL DEFAULT '{}'::jsonb,
    state            TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed')),
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_operation_model_created ON media_operation(org_id, model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_operation_source ON media_operation(org_id, source_asset_id, created_at DESC);

ALTER TABLE media_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_operation FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON media_operation USING (org_id = current_setting('app.current_org_id')::uuid) WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON media_operation FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_operation TO axiom_app;
GRANT ALL ON media_operation TO axiom_migrator;
