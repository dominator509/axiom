-- Migration 0006 — relay command execution support (H-3)
--
-- The relay command router executes verified (HMAC-signed, LBI-04) commands
-- against domain state. Commands carry no session, so the API cannot know the
-- org up front — it resolves it from the relay_card row. That lookup must
-- cross org boundaries, which RLS FORCE forbids for normal queries. Mirrors
-- the claim_job pattern: a SECURITY DEFINER function owned by axiom_migrator
-- (BYPASSRLS, the only cross-org surface in the system) resolves the card,
-- and the caller then switches into the card's org context for all domain
-- writes (still tenant-scoped, LBI-02).

BEGIN;

CREATE OR REPLACE FUNCTION resolve_relay_card(p_card_id uuid)
RETURNS TABLE (org_id uuid, bundle_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT rc.org_id, rc.bundle_id
      FROM relay_card rc
     WHERE rc.id = p_card_id
     LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION resolve_relay_card(uuid) TO axiom_app;
GRANT EXECUTE ON FUNCTION resolve_relay_card(uuid) TO axiom_migrator;

COMMIT;
