-- ============================================================================
-- AXIOM — Initial Database Migration (0000) — pgvector-compatible
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- 2. Roles
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axiom_app') THEN
    CREATE ROLE axiom_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axiom_migrator') THEN
    CREATE ROLE axiom_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;

-- ============================================================================
-- 3. Domain Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS org (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    logo_url    TEXT,
    settings    JSONB       DEFAULT '{}'::jsonb,
    features    JSONB       DEFAULT '[]'::jsonb,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id),
    email        TEXT        NOT NULL UNIQUE,
    display_name TEXT        NOT NULL,
    avatar_url   TEXT,
    role         TEXT        NOT NULL DEFAULT 'operator',
    is_active    BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_profile (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id),
    display_name TEXT        NOT NULL,
    handle       TEXT        NOT NULL,
    avatar_url   TEXT,
    bio          TEXT,
    is_active    BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_record (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id     UUID        NOT NULL REFERENCES model_profile(id),
    platform     TEXT        NOT NULL,
    consent_type TEXT        NOT NULL,
    granted      BOOLEAN     NOT NULL,
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_connection (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        NOT NULL REFERENCES org(id),
    model_id      UUID        NOT NULL REFERENCES model_profile(id),
    platform      TEXT        NOT NULL,
    display_name  TEXT        NOT NULL,
    enc_token     BYTEA       NOT NULL,
    enc_nonce     BYTEA       NOT NULL,
    dek_id        TEXT        NOT NULL,
    capabilities  JSONB       DEFAULT '[]'::jsonb,
    status        TEXT        NOT NULL DEFAULT 'active',
    connected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES org(id),
    model_id    UUID        NOT NULL REFERENCES model_profile(id),
    file_name   TEXT        NOT NULL,
    mime_type   TEXT        NOT NULL,
    file_size   INTEGER     NOT NULL,
    storage_key TEXT        NOT NULL,
    width       INTEGER,
    height      INTEGER,
    duration    INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_bundle (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID        NOT NULL REFERENCES org(id),
    model_id   UUID        NOT NULL REFERENCES model_profile(id),
    asset_id   UUID        REFERENCES asset(id),
    captions   JSONB       DEFAULT '{}'::jsonb,
    hashtags   JSONB       DEFAULT '[]'::jsonb,
    tos_report JSONB,
    state      TEXT        NOT NULL DEFAULT 'generated',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_target (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        NOT NULL REFERENCES org(id),
    bundle_id     UUID        NOT NULL REFERENCES content_bundle(id),
    platform      TEXT        NOT NULL,
    connection_id UUID        REFERENCES platform_connection(id),
    scheduled_for TIMESTAMPTZ,
    state         TEXT        NOT NULL DEFAULT 'pending',
    remote_id     TEXT,
    error         TEXT,
    idem_key      BYTEA
);

CREATE TABLE IF NOT EXISTS relay_card (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES org(id),
    title       TEXT        NOT NULL,
    description TEXT,
    icon        TEXT,
    config      JSONB       DEFAULT '{}'::jsonb,
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    priority    INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relay_command (
    id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id  UUID    NOT NULL REFERENCES org(id),
    card_id UUID    NOT NULL REFERENCES relay_card(id),
    trigger TEXT    NOT NULL,
    action  TEXT    NOT NULL,
    params  JSONB   DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS viral_exemplar (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        NOT NULL REFERENCES org(id),
    platform      TEXT        NOT NULL,
    title         TEXT        NOT NULL,
    url           TEXT        NOT NULL,
    thumbnail_url TEXT,
    viral_label   TEXT        NOT NULL,
    metrics       JSONB       DEFAULT '{"views":0,"likes":0,"shares":0,"comments":0}'::jsonb,
    ai_notes      TEXT,
    embedding     vector(1536) DEFAULT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_metric (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_target_id  UUID        NOT NULL REFERENCES post_target(id),
    platform        TEXT        NOT NULL,
    remote_id       TEXT        NOT NULL,
    views           BIGINT      NOT NULL DEFAULT 0,
    likes           BIGINT      NOT NULL DEFAULT 0,
    shares          BIGINT      NOT NULL DEFAULT 0,
    comments        BIGINT      NOT NULL DEFAULT 0,
    engagement_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    collected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID        NOT NULL REFERENCES org(id),
    queue          TEXT        NOT NULL,
    kind           TEXT        NOT NULL,
    payload        JSONB       DEFAULT '{}'::jsonb,
    state          TEXT        NOT NULL DEFAULT 'ready',
    attempts       INTEGER     NOT NULL DEFAULT 0,
    max_attempts   INTEGER     NOT NULL DEFAULT 3,
    last_error     TEXT,
    scheduled_for  TIMESTAMPTZ,
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_ledger (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        NOT NULL REFERENCES org(id),
    idem_key      TEXT        NOT NULL UNIQUE,
    response_hash TEXT,
    locked        BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id    UUID        NOT NULL REFERENCES org(id),
    actor_ref TEXT        NOT NULL,
    action    TEXT        NOT NULL,
    target    TEXT        NOT NULL,
    detail    JSONB       DEFAULT '{}'::jsonb,
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_hash BYTEA       NOT NULL,
    row_hash  BYTEA       NOT NULL
);

-- ============================================================================
-- 4. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_org_slug ON org(slug);
CREATE INDEX IF NOT EXISTS idx_app_user_org_id ON app_user(org_id);
CREATE INDEX IF NOT EXISTS idx_app_user_email  ON app_user(email);
CREATE INDEX IF NOT EXISTS idx_model_profile_org_id ON model_profile(org_id);
CREATE INDEX IF NOT EXISTS idx_consent_record_model_id ON consent_record(model_id);
CREATE INDEX IF NOT EXISTS idx_platform_connection_org_id ON platform_connection(org_id);
CREATE INDEX IF NOT EXISTS idx_platform_connection_model_id ON platform_connection(model_id);
CREATE INDEX IF NOT EXISTS idx_asset_org_id ON asset(org_id);
CREATE INDEX IF NOT EXISTS idx_asset_model_id ON asset(model_id);
CREATE INDEX IF NOT EXISTS idx_content_bundle_org_id ON content_bundle(org_id);
CREATE INDEX IF NOT EXISTS idx_content_bundle_model_id ON content_bundle(model_id);
CREATE INDEX IF NOT EXISTS idx_post_target_org_id ON post_target(org_id);
CREATE INDEX IF NOT EXISTS idx_post_target_bundle_id ON post_target(bundle_id);
CREATE INDEX IF NOT EXISTS idx_relay_card_org_id ON relay_card(org_id);
CREATE INDEX IF NOT EXISTS idx_relay_command_org_id ON relay_command(org_id);
CREATE INDEX IF NOT EXISTS idx_relay_command_card_id ON relay_command(card_id);
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_org_id ON viral_exemplar(org_id);
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_platform ON viral_exemplar(platform);
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_embedding ON viral_exemplar
    USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_post_metric_post_target_id ON post_metric(post_target_id);
CREATE INDEX IF NOT EXISTS idx_post_metric_collected_at ON post_metric(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_org_id ON job(org_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_state ON job(queue, state);
CREATE INDEX IF NOT EXISTS idx_idempotency_ledger_org_id ON idempotency_ledger(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC);

-- ============================================================================
-- 5. Row-Level Security
-- ============================================================================

ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE org FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON org
    USING (id = current_setting('app.current_org_id')::uuid);

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON app_user
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE model_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON model_profile
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE platform_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connection FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON platform_connection
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON asset
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE content_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON content_bundle
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE post_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_target FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON post_target
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE relay_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_card FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON relay_card
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE relay_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_command FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON relay_command
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE viral_exemplar ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_exemplar FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON viral_exemplar
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE job ENABLE ROW LEVEL SECURITY;
ALTER TABLE job FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON job
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE idempotency_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON idempotency_ledger
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON audit_log
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_record FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON consent_record
    USING (model_id IN (
        SELECT id FROM model_profile
        WHERE org_id = current_setting('app.current_org_id')::uuid
    ));

ALTER TABLE post_metric ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_metric FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON post_metric
    USING (post_target_id IN (
        SELECT pt.id FROM post_target pt
        JOIN content_bundle cb ON pt.bundle_id = cb.id
        WHERE cb.org_id = current_setting('app.current_org_id')::uuid
    ));

-- ============================================================================
-- 6. Grant Privileges
-- ============================================================================

GRANT USAGE ON SCHEMA public TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO axiom_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO axiom_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO axiom_app;

GRANT ALL ON SCHEMA public TO axiom_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO axiom_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO axiom_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE axiom_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO axiom_app;
ALTER DEFAULT PRIVILEGES FOR ROLE axiom_migrator IN SCHEMA public
    GRANT USAGE ON SEQUENCES TO axiom_app;
ALTER DEFAULT PRIVILEGES FOR ROLE axiom_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO axiom_app;

-- ============================================================================
-- 7. Genesis
-- ============================================================================

DO $$
DECLARE
    v_org_id UUID;
    v_count  INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM audit_log WHERE actor_ref = 'system' AND action = 'genesis';
    IF v_count = 0 THEN
        INSERT INTO org (id, name, slug, settings, features)
        VALUES ('00000000-0000-0000-0000-000000000000', 'Placeholder Org', 'placeholder',
                '{}'::jsonb, '[]'::jsonb)
        ON CONFLICT (id) DO NOTHING;
        SELECT id INTO v_org_id FROM org ORDER BY created_at ASC LIMIT 1;
        INSERT INTO audit_log (org_id, actor_ref, action, target, detail, prev_hash, row_hash)
        VALUES (
            v_org_id,
            'system',
            'genesis',
            'audit_log',
            '{"note": "Genesis block — chain initialized"}'::jsonb,
            decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
            sha256('genesis'::bytea)
        );
    END IF;
END
$$;

-- ============================================================================
-- 8. Finalise
-- ============================================================================

COMMIT;
