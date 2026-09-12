// One-transaction recovery cutover. Rehearse on a restored copy before commit.
// SQL and secrets are never emitted; an error aborts the complete transaction.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const mode=process.argv[2], targetCopy=process.argv[3], reference=process.argv[4];
assert.ok(['--rehearse-copy','--commit-original'].includes(mode));
assert.match(reference??'',/^axiom_upgrade_[a-f0-9]{16}$/);
if(mode==='--rehearse-copy') assert.match(targetCopy??'',/^axiom_upgrade_[a-f0-9]{16}$/);
else assert.equal(targetCopy,'configured-recovery');
loadEnvFile(new URL('../.env',import.meta.url));
const url=new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
assert.equal(url.port,'35433');
const require=createRequire(new URL('../packages/db/package.json',import.meta.url));
const {Client}=require('pg');
const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:5000});
let owner,original;
try {
  await client.connect();
  ({rows:[{owner,original}]}=await client.query('SELECT pg_get_userbyid(datdba) AS owner, datname AS original FROM pg_database WHERE datname=current_database()'));
} catch {throw new Error('Recovery upgrade inventory failed');}
finally {await client.end().catch(()=>{});}
const target=mode==='--rehearse-copy'?targetCopy:original;
assert.notEqual(target,reference);
const sql=(database,input)=>{
  const result=spawnSync('docker',['exec','-i','axiom-recovery-postgres','psql','-X','-w','-q','-t','-A',
    '-U',owner,'-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
  const sqlstate=result.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]??'unavailable';
  if(result.status!==0 && sqlstate==='55000') {
    // Static transaction/DDL prerequisite diagnostic only, not DETAIL/CONTEXT
    // (which can contain data). No SQL or connection parameters are emitted.
    const first=result.stderr.match(/ERROR:\s+55000:\s*([^\r\n]+)/)?.[1];
    if(first && /(?:isolation|transaction|lock|hypertable|temporary)/i.test(first))
      console.error(`Upgrade prerequisite: ${first.slice(0,240)}`);
  }
  assert.equal(result.status,0,`Guarded upgrade failed (SQLSTATE ${sqlstate}); diagnostics suppressed`);
  return result.stdout.trim();
};
if(mode==='--rehearse-copy') assert.equal(sql(target,"SELECT has_database_privilege('axiom_app',current_database(),'CONNECT');"),'f');
assert.equal(sql(reference,"SELECT has_database_privilege('axiom_app',current_database(),'CONNECT');"),'f');
assert.equal(sql(target,"SELECT to_regclass('public.axiom_schema_migrations') IS NULL AND to_regclass('public.media_generation_attempt') IS NULL;"),'t');
const contract=readFileSync(new URL('./schema-contract.sql',import.meta.url),'utf8').trim().replace(/;$/,'');
const expected=JSON.parse(sql(reference,contract));
const tag=`expected_${randomBytes(12).toString('hex')}`;
const literal=JSON.stringify(expected);
assert.ok(!literal.includes(`$${tag}$`));
const directory=new URL('../packages/db/migrations/',import.meta.url);
const files=readdirSync(directory).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
assert.equal(files.length,26);
const bodies=files.filter(name=>/^00(1[4-9]|2[0-5])_/.test(name)).map(name=>readFileSync(new URL(name,directory),'utf8')
  .replace(/\r\n/g,'\n').replace(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gm,'')
  .replace(/TO axiom;/g,'TO axiom_app;').replace(/TO axiom'/g,"TO axiom_app'"));
const ledger=files.map(name=>`('${name}','${createHash('sha256').update(readFileSync(new URL(name,directory))).digest('hex')}')`).join(',');
const transaction=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(1935763821);
CREATE TEMP TABLE before_upgrade(table_name text, columns_sql text, fingerprint text) ON COMMIT DROP;
DO $capture$
DECLARE r record; digest text;
BEGIN
 FOR r IN SELECT c.relname, string_agg(quote_ident(a.attname),', ' ORDER BY a.attnum) AS cols
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped GROUP BY c.relname
 LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',r.relname);
  EXECUTE format($hash$SELECT md5(COALESCE(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text)::text,'[]')) FROM (SELECT %s FROM public.%I) q$hash$,r.cols,r.relname) INTO digest;
  INSERT INTO before_upgrade VALUES(r.relname,r.cols,digest);
 END LOOP;
END $capture$;
${bodies.join('\n')}
DO $verify$
DECLARE actual jsonb; upgrade_item record; digest text;
BEGIN
 SELECT document INTO actual FROM (${contract}) AS inventory(document);
 IF actual IS DISTINCT FROM $${tag}$${literal}$${tag}$::jsonb THEN RAISE EXCEPTION USING ERRCODE='AXS01',MESSAGE='AXIOM_SCHEMA_MISMATCH'; END IF;
 FOR upgrade_item IN SELECT * FROM before_upgrade LOOP
  EXECUTE format($hash$SELECT md5(COALESCE(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text)::text,'[]')) FROM (SELECT %s FROM public.%I) q$hash$,upgrade_item.columns_sql,upgrade_item.table_name) INTO digest;
  IF digest IS DISTINCT FROM upgrade_item.fingerprint THEN RAISE EXCEPTION USING ERRCODE='AXD01',MESSAGE='AXIOM_EXISTING_DATA_CHANGED'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM consent_record cr JOIN model_profile mp ON mp.id=cr.model_id WHERE cr.org_id<>mp.org_id)
 THEN RAISE EXCEPTION 'AXIOM_CONSENT_BACKFILL_MISMATCH'; END IF;
END $verify$;
CREATE TABLE public.axiom_schema_migrations(migration_name text PRIMARY KEY, checksum_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON public.axiom_schema_migrations FROM PUBLIC, axiom_app;
INSERT INTO public.axiom_schema_migrations(migration_name,checksum_sha256) VALUES ${ledger};
COMMIT;`;
sql(target,transaction);
assert.equal(sql(target,'SELECT count(*) FROM public.axiom_schema_migrations;'),'26');
console.log(JSON.stringify({committed:true,mode,recorded_checksums:26,existing_data_fingerprints_preserved:true,
  schema_matches_reference:true,scope:'Application metadata contract and existing column values; no provider or end-to-end claim'}));
