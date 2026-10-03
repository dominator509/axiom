-- ============================================================================
-- axiomatic-migrator-prerequisites.sql
-- ============================================================================
-- Minimal, explicit, repeatable administrative prerequisites required before
-- the remaining migration set (0027..0047) can be applied by axiom_migrator.
--
-- EXECUTE AS : fanthynks_admin  (owner of the target tables)
-- IDEMPOTENT : yes -- every statement is a no-op when already satisfied
--
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- ----------------------------------------------------------------------------
-- This FanThynks TEST database was bootstrapped in two stages. Twenty-nine
-- tables were created by axiom_migrator, but six were created by
-- fanthynks_admin (the bootstrap role). Three of those six are touched by
-- pending migrations, which execute AS axiom_migrator:
--
--   agent_permission : 0028 creates FOREIGN KEY ... REFERENCES agent_permission(id)
--                      -> needs a COLUMN-LEVEL REFERENCES grant
--   asset_variant    : 0030/0033/0036 reference it; 0035 ALTERs it and indexes it
--                      -> needs column-level REFERENCES *and* ownership
--   viral_recipe     : 0040 ALTERs it (ADD COLUMN + ADD UNIQUE CONSTRAINT)
--                      -> needs ownership
--   bandit_state     : 0041 creates a UNIQUE INDEX on it
--                      -> needs ownership  (discovered by running the rehearsal)
--
-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT DONE
-- ----------------------------------------------------------------------------
--   * no rewriting of checksum-recorded migrations
--   * no dropping or weakening of foreign keys
--   * no superuser execution of the migration set
--   * no REASSIGN OWNED            (would move unrelated objects)
--   * no GRANT ... ON ALL TABLES   (blanket grant)
--   * no GRANT fanthynks_admin TO  (broad role membership)
--
-- NET EFFECT (verified by the successful rehearsal):
--   * THREE ownership transfers   : asset_variant, viral_recipe, bandit_state
--   * TWO column-level REFERENCES : agent_permission, asset_variant
--   * agent_permission KEEPS its owner (fanthynks_admin); only a grant is added.
--
-- The other three fanthynks_admin-owned tables -- kill_switch, api_key and
-- api_idempotency -- are NOT referenced by any migration in 0027..0047 and are
-- therefore EXCLUDED. Verified by parsing every pending migration for
-- ALTER TABLE, CREATE INDEX ... ON, and REFERENCES targets.
--
-- WHY OWNERSHIP RATHER THAN A GRANT FOR ALTER:
--   PostgreSQL has no grantable ALTER privilege. ALTER TABLE / CREATE INDEX
--   require the caller to be the table owner (or a superuser). Column-level
--   REFERENCES, by contrast, IS grantable and is kept as narrow as possible.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- BEFORE: record owners and the exact privileges we intend to add
-- ---------------------------------------------------------------------------
\echo '--- BEFORE: owners / privileges ---'
SELECT c.relname                                                   AS table_name,
       c.relowner::regrole::text                                   AS owner,
       has_column_privilege('axiom_migrator', c.oid, 'id', 'REFERENCES') AS mig_ref_id,
       has_table_privilege ('axiom_migrator', c.oid, 'SELECT')     AS mig_select,
       has_table_privilege ('axiom_migrator', c.oid, 'INSERT')     AS mig_insert,
       has_table_privilege ('axiom_migrator', c.oid, 'UPDATE')     AS mig_update
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('agent_permission','asset_variant','viral_recipe','bandit_state')
ORDER  BY c.relname;

-- ---------------------------------------------------------------------------
-- 1. REFERENCES grants -- column-level (id) only, exactly what the FKs target.
--    A table-level REFERENCES grant would be broader than required.
-- ---------------------------------------------------------------------------
\echo '--- 1a. GRANT REFERENCES (id) ON agent_permission  [for 0028] ---'
GRANT REFERENCES (id) ON TABLE public.agent_permission TO axiom_migrator;

\echo '--- 1b. GRANT REFERENCES (id) ON asset_variant     [for 0030/0033/0036] ---'
GRANT REFERENCES (id) ON TABLE public.asset_variant TO axiom_migrator;

-- ---------------------------------------------------------------------------
-- 2. Ownership transfers -- required because 0035/0040/0041 ALTER or INDEX
--    these tables, and ALTER privilege is not grantable in PostgreSQL.
-- ---------------------------------------------------------------------------
\echo '--- 2a. ALTER TABLE asset_variant OWNER TO axiom_migrator  [0035] ---'
ALTER TABLE public.asset_variant OWNER TO axiom_migrator;

\echo '--- 2b. ALTER TABLE viral_recipe OWNER TO axiom_migrator   [0040] ---'
ALTER TABLE public.viral_recipe OWNER TO axiom_migrator;

\echo '--- 2c. ALTER TABLE bandit_state OWNER TO axiom_migrator   [0041] ---'
ALTER TABLE public.bandit_state OWNER TO axiom_migrator;

-- ---------------------------------------------------------------------------
-- 3. Preserve RUNTIME access. axiom_app previously held explicit grants from
--    fanthynks_admin on the transferred tables. Verify nothing regressed.
-- ---------------------------------------------------------------------------
\echo '--- 3. assert: axiom_app retains runtime privileges ---'
DO $$
DECLARE
  missing text := '';
  t text;
  p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_permission','asset_variant','viral_recipe','bandit_state']
  LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      IF NOT has_table_privilege('axiom_app', format('public.%I', t), p) THEN
        missing := missing || format(' %s:%s', t, p);
      END IF;
    END LOOP;
  END LOOP;
  IF missing <> '' THEN
    RAISE EXCEPTION 'axiom_app lost runtime privileges:%', missing;
  END IF;
  RAISE NOTICE 'axiom_app privileges intact (4 checked)';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Assert RLS is unchanged -- an ownership transfer must not disturb it
-- ---------------------------------------------------------------------------
\echo '--- 4. assert: RLS state ---'
SELECT c.relname,
       c.relrowsecurity      AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('agent_permission','asset_variant','viral_recipe','bandit_state')
ORDER  BY c.relname;

-- ---------------------------------------------------------------------------
-- 5. Assert the migrator can now do what the migrations require
-- ---------------------------------------------------------------------------
\echo '--- 5. assert: migrator capability ---'
DO $$
DECLARE
  bad text := '';
BEGIN
  IF NOT has_column_privilege('axiom_migrator','agent_permission','id','REFERENCES') THEN
    bad := bad || ' agent_permission.REFERENCES';
  END IF;
  IF NOT has_column_privilege('axiom_migrator','asset_variant','id','REFERENCES') THEN
    bad := bad || ' asset_variant.REFERENCES';
  END IF;
  IF NOT (SELECT c.relowner = (SELECT oid FROM pg_roles WHERE rolname='axiom_migrator')
            FROM pg_class c WHERE c.relname='asset_variant') THEN
    bad := bad || ' asset_variant.OWNER';
  END IF;
  IF NOT (SELECT c.relowner = (SELECT oid FROM pg_roles WHERE rolname='axiom_migrator')
            FROM pg_class c WHERE c.relname='viral_recipe') THEN
    bad := bad || ' viral_recipe.OWNER';
  END IF;
  IF NOT (SELECT c.relowner = (SELECT oid FROM pg_roles WHERE rolname='axiom_migrator')
            FROM pg_class c WHERE c.relname='bandit_state') THEN
    bad := bad || ' bandit_state.OWNER';
  END IF;

  -- agent_permission must REMAIN owned by fanthynks_admin: only the narrow
  -- column-level REFERENCES grant is required, no ownership transfer.
  IF NOT (SELECT c.relowner = (SELECT oid FROM pg_roles WHERE rolname='fanthynks_admin')
            FROM pg_class c WHERE c.relname='agent_permission') THEN
    bad := bad || ' agent_permission.OWNER_MUST_STAY_fanthynks_admin';
  END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION 'prerequisites not satisfied:%', bad;
  END IF;
  RAISE NOTICE 'all migration prerequisites satisfied: 3 ownership transfers, 2 column-level REFERENCES grants, agent_permission owner preserved';
END $$;

-- ---------------------------------------------------------------------------
-- AFTER: record resulting state
-- ---------------------------------------------------------------------------
\echo '--- AFTER: owners / privileges ---'
SELECT c.relname                                                   AS table_name,
       c.relowner::regrole::text                                   AS owner,
       has_column_privilege('axiom_migrator', c.oid, 'id', 'REFERENCES') AS mig_ref_id,
       has_table_privilege ('axiom_migrator', c.oid, 'SELECT')     AS mig_select,
       has_table_privilege ('axiom_migrator', c.oid, 'INSERT')     AS mig_insert,
       has_table_privilege ('axiom_migrator', c.oid, 'UPDATE')     AS mig_update
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('agent_permission','asset_variant','viral_recipe','bandit_state')
ORDER  BY c.relname;

COMMIT;

-- ============================================================================
-- ROLLBACK  (manual; run only if the upgrade is abandoned)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE public.asset_variant OWNER TO fanthynks_admin;
--   ALTER TABLE public.viral_recipe  OWNER TO fanthynks_admin;
--   ALTER TABLE public.bandit_state  OWNER TO fanthynks_admin;
--   REVOKE REFERENCES (id) ON TABLE public.asset_variant    FROM axiom_migrator;
--   REVOKE REFERENCES (id) ON TABLE public.agent_permission FROM axiom_migrator;
-- COMMIT;
--
-- ROLLBACK IMPLICATIONS
--   * Valid only BEFORE the pending migrations run. Once 0035/0040/0041 have
--     applied, the transferred tables carry migrator-created columns/indexes;
--     reverting ownership is still safe but leaves an inconsistent picture.
--   * Reverting ownership does not drop added columns or constraints. Use the
--     migration ledger (axiom_schema_migrations) to decide whether a data
--     rollback is required.
--   * The REFERENCES grants are additive and harmless if left in place.
--   * axiom_app's runtime grants are untouched either way.
-- ============================================================================
