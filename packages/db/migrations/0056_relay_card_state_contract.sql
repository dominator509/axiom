-- F-85/F-28: make the stored-vs-dispatched relay-card lifecycle explicit.
-- A digest card is durable internal state; it is not an external provider
-- receipt. Existing rows are checked before the constraint is installed so a
-- deployment cannot silently reinterpret an unknown legacy state.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM relay_card
     WHERE state NOT IN ('stored', 'pending', 'sent', 'failed', 'unknown')
  ) THEN
    RAISE EXCEPTION
      'relay_card contains an unrecognized state; reconcile it before applying 0056';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.relay_card'::regclass
       AND conname = 'relay_card_state_allowed'
  ) THEN
    ALTER TABLE relay_card
      ADD CONSTRAINT relay_card_state_allowed
      CHECK (state IN ('stored', 'pending', 'sent', 'failed', 'unknown'));
  END IF;
END
$$;

COMMENT ON COLUMN relay_card.state IS
  'stored means no external dispatch was attempted; pending/sent/failed/unknown belong to the dispatch lifecycle';

COMMIT;
