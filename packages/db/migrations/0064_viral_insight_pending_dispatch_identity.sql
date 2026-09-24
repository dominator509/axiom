-- AXIOM migration 0064 — F-85 model-scoped Relay dispatch idempotency.
-- Model insight delivery rows intentionally have no bundle_id. The legacy
-- pending index therefore cannot protect them because PostgreSQL permits
-- multiple NULL bundle_id values in a unique index.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM relay_card
     WHERE state = 'pending'
       AND model_id IS NOT NULL
       AND bundle_id IS NULL
     GROUP BY org_id, model_id, channel, external_ref
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'relay_card contains duplicate model-scoped pending dispatch markers; reconcile before applying 0064';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS relay_card_viral_pending_dispatch_unique
    ON relay_card (org_id, model_id, channel, external_ref)
    WHERE state = 'pending' AND model_id IS NOT NULL AND bundle_id IS NULL;

COMMIT;
