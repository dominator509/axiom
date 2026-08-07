-- Migration 0007 — MCP tool DB support (H-2)
--
-- The CRM MCP server tools (analytics_query, inbox_manage, generation_photoshoot,
-- publishing_post, network_configure) execute real DB operations. Capability
-- tokens scope an agent to a model but carry no org, and RLS FORCE forbids
-- cross-org SELECTs — so the model→org lookup must go through a SECURITY
-- DEFINER resolver (same pattern as claim_job / resolve_relay_card, LBI-02).
-- The caller then switches into the model's org context for all domain writes.

BEGIN;

CREATE OR REPLACE FUNCTION resolve_model_org(p_model_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM model_profile WHERE id = p_model_id LIMIT 1;
  RETURN v_org_id;
END $$;

GRANT EXECUTE ON FUNCTION resolve_model_org(uuid) TO axiom_app;
GRANT EXECUTE ON FUNCTION resolve_model_org(uuid) TO axiom_migrator;

COMMIT;
