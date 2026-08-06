-- ============================================================================
-- AXIOM — Migration 0002 — Dashboard domain tables + Better Auth tables
-- ============================================================================
-- Adds the tables the operator dashboard (L4.5 step 5) and authentication
-- (Better Auth, L2.0 orchestration plane) require:
--   auth_user / auth_session / auth_account / auth_verification  (identity)
--   org_settings          (kill switch state, F-12 / LBI-11)
--   fan_crm_contact       (high-value fan CRM, F-05 / F-06)
--   fan_touchpoint        (unified fan timeline, F-07)
--   custom_request        (ticketing: Pending/Filming/Editing/Delivered, F-08)
--   linkbio_provider      (0..n active link-in-bio providers, F-48..F-53)
--   linkbio_click         (normalized click analytics, F-53)
--   short_link            (built-in shortener + UTMs, F-22 / F-23)
--   playbook_score        (Fanvue Course Adherence Score history, F-57)
-- All org-scoped tables carry org_id and get the org_isolation RLS policy
-- (LBI-02), same pattern as migration 0001.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Better Auth identity tables (cross-tenant; NOT RLS-scoped — the session
--    lookup happens before org context exists. org_id + role live on auth_user
--    so the API middleware can resolve the tenant from the session).
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth_user (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    image         TEXT,
    org_id        UUID REFERENCES org(id) ON DELETE SET NULL,
    role          TEXT NOT NULL DEFAULT 'operator',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_session (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    token         TEXT NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    ip_address    TEXT,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_account (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    account_id       TEXT NOT NULL,
    provider_id      TEXT NOT NULL,
    access_token     TEXT,
    refresh_token    TEXT,
    access_token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    scope            TEXT,
    id_token         TEXT,
    password         TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_verification (
    id            TEXT PRIMARY KEY,
    identifier    TEXT NOT NULL,
    value         TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. org_settings — kill switch + publishing gate (F-12, LBI-11)
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_settings (
    org_id                 UUID PRIMARY KEY REFERENCES org(id) ON DELETE CASCADE,
    publishing_enabled     BOOLEAN NOT NULL DEFAULT true,
    kill_switch_reason     TEXT,
    kill_switch_actor      TEXT,
    kill_switch_at         TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. Fan CRM (F-05..F-08)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fan_crm_contact (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL,
    external_id      TEXT NOT NULL,
    display_name     TEXT,
    tier             TEXT NOT NULL DEFAULT 'new'
                     CHECK (tier IN ('whale','loyal','expired','new')),
    lifetime_value_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
    last_active_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, model_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS fan_touchpoint (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    fan_id           UUID NOT NULL REFERENCES fan_crm_contact(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL,
    kind             TEXT NOT NULL,
    direction        TEXT NOT NULL DEFAULT 'inbound'
                     CHECK (direction IN ('inbound','outbound')),
    content          TEXT,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_request (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    fan_id           UUID REFERENCES fan_crm_contact(id) ON DELETE SET NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','filming','editing','delivered')),
    price_usd        NUMERIC(12,2),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. Link-in-bio (F-48..F-53)
-- ============================================================================

CREATE TABLE IF NOT EXISTS linkbio_provider (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('native','fanlynks','linktree','beacons')),
    enabled          BOOLEAN NOT NULL DEFAULT true,
    is_primary       BOOLEAN NOT NULL DEFAULT false,
    config           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, model_id, kind)
);

CREATE TABLE IF NOT EXISTS linkbio_click (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    provider_id      UUID NOT NULL REFERENCES linkbio_provider(id) ON DELETE CASCADE,
    target           TEXT NOT NULL,
    source           TEXT,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. Short links + attribution (F-22 / F-23)
-- ============================================================================

CREATE TABLE IF NOT EXISTS short_link (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    slug             TEXT NOT NULL,
    target_url       TEXT NOT NULL,
    utm              JSONB NOT NULL DEFAULT '{}'::jsonb,
    clicks           INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);

-- ============================================================================
-- 6. Playbook adherence score history (F-57)
-- ============================================================================

CREATE TABLE IF NOT EXISTS playbook_score (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    score            INTEGER NOT NULL,
    components       JSONB NOT NULL DEFAULT '{}'::jsonb,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 7. RLS — org_isolation on every org-scoped table (LBI-02)
-- ============================================================================

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'org_settings',
        'fan_crm_contact',
        'fan_touchpoint',
        'custom_request',
        'linkbio_provider',
        'linkbio_click',
        'short_link',
        'playbook_score'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY org_isolation ON %I USING (org_id = current_setting(''app.current_org_id'')::uuid)',
            t
        );
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO axiom_app', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO axiom', t);
    END LOOP;
END
$$;

-- Indexes for dashboard hot paths
CREATE INDEX IF NOT EXISTS idx_fan_crm_contact_model ON fan_crm_contact(model_id);
CREATE INDEX IF NOT EXISTS idx_fan_touchpoint_fan_ts ON fan_touchpoint(fan_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_custom_request_model_status ON custom_request(model_id, status);
CREATE INDEX IF NOT EXISTS idx_linkbio_click_provider_ts ON linkbio_click(provider_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_score_model_ts ON playbook_score(model_id, ts DESC);

-- Seed: kill switch default row for the genesis org
INSERT INTO org_settings (org_id)
SELECT id FROM org
WHERE id = '00000000-0000-0000-0000-000000000000'
ON CONFLICT (org_id) DO NOTHING;

COMMIT;
