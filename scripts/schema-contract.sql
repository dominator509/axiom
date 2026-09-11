-- Application schema metadata only. Excludes extension-owned functions and
-- internal Timescale schemas; never reads application records or credentials.
SELECT jsonb_build_object(
 'columns', (SELECT jsonb_object_agg(c.table_name || '.' || c.column_name,
   jsonb_build_array(c.data_type,c.udt_name,c.is_nullable,c.column_default,
     c.character_maximum_length,c.numeric_precision,c.numeric_scale,
     (SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a
       WHERE a.attrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)))
   FROM information_schema.columns c WHERE c.table_schema='public'),
 'constraints', (SELECT jsonb_object_agg(r.relname || '.' || c.conname,
   jsonb_build_array(c.contype,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred))
   FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
   WHERE n.nspname='public'),
 'indexes', (SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE schemaname='public'),
 'rls', (SELECT jsonb_object_agg(c.relname,jsonb_build_array(c.relrowsecurity,c.relforcerowsecurity))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'policies', (SELECT jsonb_object_agg(tablename || '.' || policyname,
   jsonb_build_array(permissive,roles,cmd,qual,with_check)) FROM pg_policies WHERE schemaname='public'),
 'functions', (SELECT jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
   jsonb_build_array(replace(p.prosrc,E'\r\n',E'\n'),p.prosecdef,p.provolatile,p.proconfig,
     owner.rolsuper OR owner.rolbypassrls,
     has_function_privilege('axiom_app',p.oid,'EXECUTE'),
     EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
       WHERE a.grantee=0 AND a.privilege_type='EXECUTE')))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
   WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d
     WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'table_permissions', (SELECT jsonb_object_agg(t.tablename,
   jsonb_build_array(has_table_privilege('axiom_app','public.'||t.tablename,'SELECT'),
     has_table_privilege('axiom_app','public.'||t.tablename,'INSERT'),
     has_table_privilege('axiom_app','public.'||t.tablename,'UPDATE'),
     has_table_privilege('axiom_app','public.'||t.tablename,'DELETE'),
     has_table_privilege('axiom_app','public.'||t.tablename,'TRUNCATE')))
   FROM pg_tables t WHERE t.schemaname='public'),
 'triggers', (SELECT jsonb_object_agg(c.relname||'.'||t.tgname,
     jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled))
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal),
 'enums', (SELECT jsonb_object_agg(name,labels) FROM (
   SELECT t.typname AS name,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
   FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
   WHERE n.nspname='public' GROUP BY t.typname) enums),
 'views', (SELECT jsonb_object_agg(viewname,definition) FROM pg_views WHERE schemaname='public'),
 'column_updates', (SELECT jsonb_object_agg(table_name||'.'||column_name,
     has_column_privilege('axiom_app','public.'||table_name,column_name,'UPDATE'))
   FROM information_schema.columns WHERE table_schema='public')
);
