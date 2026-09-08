-- Migration 0019 — trusted egress config resolver
--
-- The egress plane is a trusted system component that must reconcile all
-- model network bindings. Its runtime role (axiom_app) remains subject to
-- FORCE ROW LEVEL SECURITY, so it cannot enumerate tenant rows directly.
-- Mirror the existing claim_job/resolve_* pattern with one narrowly scoped,
-- ACL-locked resolver owned by the BYPASSRLS migration role.
BEGIN;

CREATE OR REPLACE FUNCTION load_model_network_configs()
RETURNS SETOF public.model_network_configs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.*
    FROM public.model_network_configs AS m
   ORDER BY m.org_id, m.model_id
$$;

REVOKE ALL ON FUNCTION load_model_network_configs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_model_network_configs() TO axiom_app;
GRANT EXECUTE ON FUNCTION load_model_network_configs() TO axiom_migrator;

COMMIT;
