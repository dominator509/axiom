-- Durable, non-secret MCP capability registry. The bearer token is never
-- persisted; token_id is only a revocation/authority lookup identifier.
CREATE TABLE IF NOT EXISTS mcp_capability_token (
    token_id     TEXT PRIMARY KEY,
    org_id       UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES agent_permission(id) ON DELETE CASCADE,
    model_id     UUID NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    agent_ref    TEXT NOT NULL,
    tier         TEXT NOT NULL,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_capability_token_scope
    ON mcp_capability_token (model_id, agent_ref, expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_capability_token_org
    ON mcp_capability_token (org_id, expires_at);

ALTER TABLE mcp_capability_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_capability_token FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON mcp_capability_token
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

REVOKE ALL ON mcp_capability_token FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON mcp_capability_token TO axiom_app;
GRANT ALL ON mcp_capability_token TO axiom_migrator;
