-- 0022_viral_exemplar_identity.sql
-- Make the viral.label executor's documented exemplar upsert atomic. Without
-- a database-enforced identity, concurrent metrics polls can both observe no
-- row and insert duplicate S2 context for the same published bundle.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM viral_exemplar
     WHERE bundle_id IS NOT NULL
     GROUP BY org_id, model_id, bundle_id, platform
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'viral_exemplar contains duplicate (org_id, model_id, bundle_id, platform) rows; deduplicate before applying 0022';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'viral_exemplar_identity'
       AND conrelid = 'public.viral_exemplar'::regclass
  ) THEN
    ALTER TABLE public.viral_exemplar
      ADD CONSTRAINT viral_exemplar_identity
      UNIQUE (org_id, model_id, bundle_id, platform);
  END IF;
END
$$;

COMMIT;
