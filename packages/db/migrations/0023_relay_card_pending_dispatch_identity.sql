-- Serialize relay.card provider dispatches for the same review destination.
-- The executor keeps sent rows as history, so only unresolved pending rows are
-- unique. Existing duplicate pending rows must be reconciled before enabling
-- the guard; silently choosing one would lose the external-outcome evidence.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM relay_card
     WHERE state = 'pending'
     GROUP BY org_id, bundle_id, channel, external_ref
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'relay_card contains duplicate pending dispatch markers; deduplicate before applying 0023';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS relay_card_pending_dispatch_unique
    ON relay_card (org_id, bundle_id, channel, external_ref)
    WHERE state = 'pending';

COMMIT;
