-- ============================================================================
-- AXIOM — Migration 0004 — Queue Worker Runtime + Missing Entity Tables
-- ============================================================================
-- 1. Job table: L3.4 worker fields (run_after, locked_by, locked_at,
--    dedupe_key) + job_pick partial index for the SKIP LOCKED claim loop.
-- 2. Fourteen entity-tree tables missing from the live DB (L2.2):
--    api_key, asset_variant, pre_post_run, analytics_snapshot, viral_recipe,
--    viral_embedding, bandit_state, seo_aeo_ranking, fanvue_metric, campaign,
--    trigger_rule, linkbio_analytics, relay_binding, agent_permission.
--    (org_settings, fan_crm_contact, fan_touchpoint, custom_request,
--     linkbio_provider, linkbio_click, short_link, playbook_score already
--     existed from migration 0002 — singular naming matches the live schema.)
-- 3. claim_job(): SECURITY DEFINER picker for the multi-tenant worker.
--    axiom_migrator owns schema + all privileges (trusted ops role), so it
--    gets BYPASSRLS to serve as the claim-function owner; axiom_app executes
--    the function but can never bypass RLS for its own queries (LBI-02).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Job table — worker runtime columns (L3.4 §3)
-- ============================================================================

ALTER TABLE job ADD COLUMN IF NOT EXISTS run_after    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE job ADD COLUMN IF NOT EXISTS locked_by    TEXT;
ALTER TABLE job ADD COLUMN IF NOT EXISTS locked_at    TIMESTAMPTZ;
ALTER TABLE job ADD COLUMN IF NOT EXISTS dedupe_key   BYTEA;

-- One job per (org, unit-of-work): duplicate enqueues collapse (L3.4 §4).
-- Multiple NULLs are allowed by Postgres, so legacy jobs stay valid.
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_org_dedupe_key;
ALTER TABLE job ADD CONSTRAINT job_org_dedupe_key UNIQUE (org_id, dedupe_key);

-- The claim loop's hot path: next ready job by run_after (L3.4 §3 / L3.1 §8).
CREATE INDEX IF NOT EXISTS job_pick ON job (state, run_after) WHERE state = 'ready';
CREATE INDEX IF NOT EXISTS idx_job_dedupe ON job (org_id) WHERE dedupe_key IS NOT NULL;

-- ============================================================================
-- 2. claim_job() — multi-tenant worker claim (L3.4 §3)
-- ============================================================================
-- Picks the oldest ready job across ALL orgs (worker is trusted), marks it
-- running with the worker identity, and sets the org context so the caller's
-- transaction is RLS-scoped for the domain work (LBI-02). SKIP LOCKED makes
-- concurrent workers claim disjoint rows without blocking.
-- SECURITY DEFINER + BYPASSRLS owner = the only cross-org read surface in the
-- system; axiom_app's own queries remain strictly tenant-scoped.

ALTER ROLE axiom_migrator BYPASSRLS;

CREATE OR REPLACE FUNCTION claim_job(p_worker text)
RETURNS SETOF job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job job%ROWTYPE;
BEGIN
  SELECT * INTO v_job
    FROM job
   WHERE state = 'ready' AND run_after <= now()
   ORDER BY run_after
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE job
     SET state = 'running',
         locked_by = p_worker,
         locked_at = now(),
         started_at = now()
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  -- Scope the caller's transaction to the claimed job's org.
  PERFORM set_config('app.current_org_id', v_job.org_id::text, true);

  RETURN NEXT v_job;
END
$$;

GRANT EXECUTE ON FUNCTION claim_job(text) TO axiom_app;
GRANT EXECUTE ON FUNCTION claim_job(text) TO axiom_migrator;

-- ============================================================================
-- 3. Entity tables (L2.2)
-- ============================================================================

-- Org-level API keys (scoped tokens for agent/CRM integrations)
CREATE TABLE IF NOT EXISTS api_key (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    key_prefix   TEXT        NOT NULL,
    key_hash     TEXT        NOT NULL,
    scopes       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-crop/per-caption media variants with performance link (F-13)
CREATE TABLE IF NOT EXISTS asset_variant (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    asset_id      UUID        NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    variant_type  TEXT        NOT NULL DEFAULT 'crop',
    width         INTEGER,
    height        INTEGER,
    storage_key   TEXT        NOT NULL,
    settings      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    perf_score    DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Abstracted Pre-Post Script execution records (L2.0 canonical flow)
CREATE TABLE IF NOT EXISTS pre_post_run (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id    UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    target_id   UUID        REFERENCES post_target(id) ON DELETE SET NULL,
    script      TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'pending',
    input       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    output      JSONB,
    error       TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Analytics snapshots (followers/engagement over time). Plain table +
-- time-series index; TimescaleDB hypertable conversion is a deployment
-- upgrade (extension not present in the default image).
CREATE TABLE IF NOT EXISTS analytics_snapshot (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id    UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    platform    TEXT        NOT NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    followers   BIGINT      NOT NULL DEFAULT 0,
    engagement  DOUBLE PRECISION NOT NULL DEFAULT 0,
    reach       BIGINT      NOT NULL DEFAULT 0,
    impressions BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Labeled high-performers with the full generative recipe (L2.8 F-81)
CREATE TABLE IF NOT EXISTS viral_recipe (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    platform         TEXT        NOT NULL,
    label            TEXT        NOT NULL DEFAULT 'baseline',
    perf_score       DOUBLE PRECISION NOT NULL DEFAULT 0,
    recipe           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    realized_metrics JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pgvector embeddings keyed to recipes (L2.8 F-82 / L3.5)
CREATE TABLE IF NOT EXISTS viral_embedding (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    recipe_id   UUID        NOT NULL REFERENCES viral_recipe(id) ON DELETE CASCADE,
    model_id    UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    platform    TEXT        NOT NULL,
    embedding   vector(768) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contextual bandit arm weights (L2.8 F-84 / L3.5 §2)
CREATE TABLE IF NOT EXISTS bandit_state (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id    UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    platform    TEXT        NOT NULL,
    context     TEXT        NOT NULL,
    arm         TEXT        NOT NULL,
    alpha       DOUBLE PRECISION NOT NULL DEFAULT 1,
    beta        DOUBLE PRECISION NOT NULL DEFAULT 1,
    plays       INTEGER     NOT NULL DEFAULT 0,
    reward      DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_id, platform, context, arm)
);

-- Keyword + AI answer-engine positions (SEO/AEO)
CREATE TABLE IF NOT EXISTS seo_aeo_ranking (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id     UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    keyword      TEXT        NOT NULL,
    engine       TEXT        NOT NULL,
    position     INTEGER,
    url          TEXT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fanvue MCP business metrics (subs, earnings, messages, tips)
CREATE TABLE IF NOT EXISTS fanvue_metric (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id         UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
    subscribers      INTEGER     NOT NULL DEFAULT 0,
    earnings_usd     NUMERIC(12,2) NOT NULL DEFAULT 0,
    messages         INTEGER     NOT NULL DEFAULT 0,
    tips             INTEGER     NOT NULL DEFAULT 0,
    tip_earnings_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
    raw              JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grouped content pushes + KPIs
CREATE TABLE IF NOT EXISTS campaign (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id     UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ,
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ,
    budget_usd   NUMERIC(12,2),
    kpi          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IFTTT-style trigger rules (condition -> action, per-platform thresholds)
CREATE TABLE IF NOT EXISTS trigger_rule (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id     UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    platform     TEXT        NOT NULL,
    condition    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    action       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    enabled      BOOLEAN     NOT NULL DEFAULT true,
    last_fired_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Normalized link-in-bio analytics across providers (L2.2)
CREATE TABLE IF NOT EXISTS linkbio_analytics (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    provider_id  UUID        REFERENCES linkbio_provider(id) ON DELETE SET NULL,
    ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind         TEXT        NOT NULL DEFAULT 'click',
    source       TEXT,
    referrer     TEXT,
    device       TEXT,
    utm_source   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which channel(s) receive a model's Relay cards (L3.3)
CREATE TABLE IF NOT EXISTS relay_binding (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    model_id   UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    channel    TEXT        NOT NULL,
    chat_ref   TEXT,
    enabled    BOOLEAN     NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_id, channel)
);

-- Per-model capability tier per agent (L2.11)
CREATE TABLE IF NOT EXISTS agent_permission (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    agent_ref    TEXT        NOT NULL,
    model_id     UUID        NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    tier         TEXT        NOT NULL DEFAULT 'read',
    can_publish  BOOLEAN     NOT NULL DEFAULT false,
    can_edit     BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_ref, model_id)
);

-- ============================================================================
-- 4. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_api_key_org_id ON api_key(org_id);
CREATE INDEX IF NOT EXISTS idx_asset_variant_org_id ON asset_variant(org_id);
CREATE INDEX IF NOT EXISTS idx_asset_variant_asset_id ON asset_variant(asset_id);
CREATE INDEX IF NOT EXISTS idx_pre_post_run_org_id ON pre_post_run(org_id);
CREATE INDEX IF NOT EXISTS idx_pre_post_run_model_id ON pre_post_run(model_id);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_org_id ON analytics_snapshot(org_id);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_model_ts ON analytics_snapshot(model_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_viral_recipe_org_id ON viral_recipe(org_id);
CREATE INDEX IF NOT EXISTS idx_viral_recipe_model_platform ON viral_recipe(model_id, platform);
CREATE INDEX IF NOT EXISTS idx_viral_embedding_org_id ON viral_embedding(org_id);
CREATE INDEX IF NOT EXISTS idx_viral_embedding_hnsw ON viral_embedding
    USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_bandit_state_org_id ON bandit_state(org_id);
CREATE INDEX IF NOT EXISTS idx_bandit_state_model_context ON bandit_state(model_id, context);
CREATE INDEX IF NOT EXISTS idx_seo_aeo_ranking_org_id ON seo_aeo_ranking(org_id);
CREATE INDEX IF NOT EXISTS idx_seo_aeo_ranking_keyword ON seo_aeo_ranking(model_id, keyword, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fanvue_metric_org_id ON fanvue_metric(org_id);
CREATE INDEX IF NOT EXISTS idx_fanvue_metric_model_ts ON fanvue_metric(model_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_org_id ON campaign(org_id);
CREATE INDEX IF NOT EXISTS idx_campaign_model_id ON campaign(model_id);
CREATE INDEX IF NOT EXISTS idx_trigger_rule_org_id ON trigger_rule(org_id);
CREATE INDEX IF NOT EXISTS idx_trigger_rule_model_id ON trigger_rule(model_id);
CREATE INDEX IF NOT EXISTS idx_linkbio_analytics_org_id ON linkbio_analytics(org_id);
CREATE INDEX IF NOT EXISTS idx_linkbio_analytics_provider_ts ON linkbio_analytics(provider_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_relay_binding_org_id ON relay_binding(org_id);
CREATE INDEX IF NOT EXISTS idx_relay_binding_model_id ON relay_binding(model_id);
CREATE INDEX IF NOT EXISTS idx_agent_permission_org_id ON agent_permission(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_permission_model_id ON agent_permission(model_id);

-- ============================================================================
-- 5. RLS — literal policy per new org-scoped table (LBI-02)
-- ============================================================================

ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON api_key
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE asset_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_variant FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON asset_variant
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE pre_post_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_post_run FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON pre_post_run
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE analytics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON analytics_snapshot
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE viral_recipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_recipe FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON viral_recipe
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE viral_embedding ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_embedding FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON viral_embedding
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE bandit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bandit_state FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON bandit_state
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE seo_aeo_ranking ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_aeo_ranking FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON seo_aeo_ranking
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE fanvue_metric ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanvue_metric FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON fanvue_metric
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON campaign
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE trigger_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON trigger_rule
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE linkbio_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkbio_analytics FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON linkbio_analytics
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE relay_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON relay_binding
    USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE agent_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_permission FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agent_permission
    USING (org_id = current_setting('app.current_org_id')::uuid);

-- ============================================================================
-- 6. Grants (least privilege for axiom_app; new tables only — 0000 already
--    granted ALL TABLES, but DEFAULT PRIVILEGES only cover future objects
--    created by axiom_migrator; these tables are created by the superuser
--    migrator, so explicit grants are required.)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON api_key TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_variant TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pre_post_run TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_snapshot TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON viral_recipe TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON viral_embedding TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bandit_state TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON seo_aeo_ranking TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fanvue_metric TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON trigger_rule TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON linkbio_analytics TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON relay_binding TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_permission TO axiom_app;

COMMIT;
