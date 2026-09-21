-- AXIOM migration 0063 — model-scoped dynamic watermark policy (F-14).
-- One policy per (org, model). Stores only bounded presentation settings plus
-- the object-key of the model's own watermark asset. It never stores provider
-- credentials, CDN tokens, signed URLs, or transformed media bytes.

BEGIN;

CREATE TABLE IF NOT EXISTS watermark_policy (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id        UUID        NOT NULL,
    enabled         BOOLEAN     NOT NULL DEFAULT false,
    watermark_key   TEXT,
    position        TEXT        NOT NULL DEFAULT 'bottom-right',
    opacity         INTEGER     NOT NULL DEFAULT 60,
    scale           INTEGER     NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT watermark_policy_position_closed
        CHECK (position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right', 'center')),
    CONSTRAINT watermark_policy_opacity_bounded
        CHECK (opacity >= 0 AND opacity <= 100),
    CONSTRAINT watermark_policy_scale_bounded
        CHECK (scale >= 5 AND scale <= 100),
    CONSTRAINT watermark_policy_key_bounded
        CHECK (watermark_key IS NULL
               OR watermark_key ~* '^generated/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'),
    -- A disabled policy must not name an asset, and an enabled policy must name
    -- exactly one: this forces fail-closed behaviour at the storage layer.
    CONSTRAINT watermark_policy_enabled_requires_key
        CHECK ((enabled = false AND watermark_key IS NULL)
               OR (enabled = true AND watermark_key IS NOT NULL)),
    CONSTRAINT watermark_policy_model_fk
        FOREIGN KEY (org_id, model_id) REFERENCES model_profile (org_id, id) ON DELETE CASCADE,
    CONSTRAINT watermark_policy_identity
        UNIQUE (org_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_watermark_policy_org_model
    ON watermark_policy(org_id, model_id);

ALTER TABLE watermark_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE watermark_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON watermark_policy
    USING (org_id = current_setting('app.current_org_id')::uuid);

-- The application role owns runtime CRUD. The migration role needs DDL rights
-- only while applying migrations; there is deliberately no blanket/undefined
-- role grant here.
GRANT SELECT, INSERT, UPDATE, DELETE ON watermark_policy TO axiom_app;
GRANT ALL PRIVILEGES ON watermark_policy TO axiom_migrator;

COMMIT;
