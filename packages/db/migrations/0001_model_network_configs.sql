-- ============================================================================
-- 0001_model_network_configs.sql
-- Per-model egress isolation config (L2.6, L2.2): egress mode, encrypted
-- credentials (envelope: enc_creds + enc_nonce + dek_id), health state,
-- expected-IP drift policy, and approved failover egress addrs.
-- Fail-closed by construction: the Rust egress plane refuses to fall back
-- to the host route when the bound egress is unhealthy (LBI-02).
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS model_network_configs (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID        NOT NULL REFERENCES org(id),
    model_id                UUID        NOT NULL REFERENCES model_profile(id),
    egress_mode             TEXT        NOT NULL DEFAULT 'direct'
                                        CHECK (egress_mode IN
                                            ('direct','socks5','http','https','wireguard','vpn')),
    proxy_type              TEXT,
    proxy_addr              TEXT,
    wg_public_key           TEXT,
    wg_endpoint             TEXT,
    wg_allowed_ips          TEXT,
    wg_persistent_keepalive INTEGER,
    expected_egress_ip      TEXT,
    failover_proxy_addrs    TEXT[]      DEFAULT '{}',
    enc_creds               BYTEA,
    enc_nonce               BYTEA,
    dek_id                  TEXT,
    healthy                 BOOLEAN     NOT NULL DEFAULT false,
    last_check              TIMESTAMPTZ,
    latency_ms              INTEGER,
    last_egress_ip          TEXT,
    fail_count              INTEGER     NOT NULL DEFAULT 0,
    last_error              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_id)
);

ALTER TABLE model_network_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_network_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON model_network_configs
    USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_model_network_configs_org_id ON model_network_configs(org_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON model_network_configs TO axiom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON model_network_configs TO axiom;

COMMIT;
