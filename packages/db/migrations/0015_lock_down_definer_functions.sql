-- 0015_lock_down_definer_functions.sql
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. These
-- SECURITY DEFINER functions cross tenant RLS boundaries, so their ACLs must
-- explicitly name only the trusted runtime and migration roles.
BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

REVOKE ALL ON FUNCTION claim_job(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_relay_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_model_org(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION claim_job(text) TO axiom_app;
GRANT EXECUTE ON FUNCTION claim_job(text) TO axiom_migrator;
GRANT EXECUTE ON FUNCTION resolve_relay_card(uuid) TO axiom_app;
GRANT EXECUTE ON FUNCTION resolve_relay_card(uuid) TO axiom_migrator;
GRANT EXECUTE ON FUNCTION resolve_model_org(uuid) TO axiom_app;
GRANT EXECUTE ON FUNCTION resolve_model_org(uuid) TO axiom_migrator;

COMMIT;
