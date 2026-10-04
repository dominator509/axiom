-- Audit records are append-only for the runtime role. Administrative fixture
-- owners and the migration role retain maintenance access outside production.
BEGIN;

REVOKE UPDATE, DELETE ON TABLE audit_log FROM axiom_app;

COMMIT;
