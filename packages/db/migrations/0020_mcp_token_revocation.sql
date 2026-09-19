-- Durable MCP capability revocation (L2.11).
-- The token_id is random and non-secret; a global denylist lets every API
-- instance reject a revoked token immediately without trusting process memory.
BEGIN;

CREATE TABLE IF NOT EXISTS mcp_token_revocation (
    token_id   TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_token_revocation_expires_at
    ON mcp_token_revocation(expires_at);

REVOKE ALL ON mcp_token_revocation FROM PUBLIC;
GRANT SELECT, INSERT ON mcp_token_revocation TO axiom_app;
GRANT SELECT, INSERT, DELETE ON mcp_token_revocation TO axiom_migrator;

COMMIT;
