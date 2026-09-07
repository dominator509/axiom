-- Align consent_record with the Drizzle schema and enforce tenant-scoped RLS.
-- Existing rows are backfilled from their model profile before org_id becomes
-- mandatory. The application role must never rely on the model subquery alone.

ALTER TABLE consent_record ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE consent_record AS cr
   SET org_id = mp.org_id
  FROM model_profile AS mp
 WHERE mp.id = cr.model_id
   AND cr.org_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM consent_record WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'consent_record rows without a model organization cannot be migrated';
  END IF;
END
$$;

ALTER TABLE consent_record ALTER COLUMN org_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'consent_record_org_id_fkey'
       AND conrelid = 'consent_record'::regclass
  ) THEN
    ALTER TABLE consent_record
      ADD CONSTRAINT consent_record_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
  END IF;
END
$$;

DROP POLICY IF EXISTS org_isolation ON consent_record;
CREATE POLICY org_isolation ON consent_record
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_consent_record_org_model
  ON consent_record (org_id, model_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON consent_record TO axiom_app;
GRANT ALL ON consent_record TO axiom_migrator;
