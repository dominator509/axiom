// Compare an upgraded private recovery copy with a freshly migrated reference
// in the labeled CI fixture. No source database or user records are modified.
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
assert.equal(process.argv[2], '--rehearsal-copy');
const copy = process.argv[3];
assert.match(copy ?? '', /^axiom_upgrade_[a-f0-9]{16}$/);
loadEnvFile(new URL('../.env', import.meta.url));
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
let owner;
try {
  await client.connect();
  ({ rows: [{ owner }] } = await client.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()'));
} catch { throw new Error('Schema comparison inventory failed'); }
finally { await client.end().catch(() => {}); }
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, 'Schema reference command failed; diagnostics suppressed');
  return result.stdout.trim();
}
const fixture = 'axiom-ci-local-6cefdc1';
const labels = JSON.parse(docker(['inspect','--format','{{json .Config.Labels}}',fixture]));
assert.equal(labels['axiom.purpose'], 'isolated-ci-validation');
const sql = (container, database, role, input) => docker(['exec','-i',container,'psql','-X','-w','-q','-t','-A','-1',
  '-U',role,'-d',database,'-v','ON_ERROR_STOP=1'],input);
assert.equal(sql('axiom-recovery-postgres',copy,owner,"SELECT has_database_privilege('axiom_app',current_database(),'CONNECT');"),'f');
const reference = `axiom_schema_reference_${randomBytes(8).toString('hex')}`;
let created = false;
try {
  docker(['exec',fixture,'createdb','-U','axiom',reference]);
  created = true;
  const directory = new URL('../packages/db/migrations/',import.meta.url);
  const files = readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  assert.equal(files.length,26);
  for (const file of files) {
    const migration = readFileSync(new URL(file,directory),'utf8').replace(/\r\n/g,'\n')
      .replace(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gm,'')
      // Match the canonical runner's historical runtime-role correction.
      .replace(/TO axiom;/g, 'TO axiom_app;').replace(/TO axiom'/g, "TO axiom_app'");
    sql(fixture,reference,'axiom',migration);
  }
  const inventory = readFileSync(new URL('./schema-contract.sql',import.meta.url),'utf8');
  const expected = JSON.parse(sql(fixture,reference,'axiom',inventory));
  const actual = JSON.parse(sql('axiom-recovery-postgres',copy,owner,inventory));
  let differences = 0;
  for (const category of Object.keys(expected)) {
    const want=expected[category]??{}, have=actual[category]??{};
    const changed=[...new Set([...Object.keys(want),...Object.keys(have)])].sort()
      .filter(key=>JSON.stringify(want[key])!==JSON.stringify(have[key]));
    differences+=changed.length;
    console.log(JSON.stringify({category,reference_objects:Object.keys(want).length,differing_objects:changed}));
  }
  console.log(JSON.stringify({schema_comparison_complete:true,differences,source_unchanged:true}));
  if(differences) process.exitCode=1;
} finally {
  assert.match(reference,/^axiom_schema_reference_[a-f0-9]{16}$/);
  if(created) docker(['exec',fixture,'dropdb','-U','axiom',reference]);
}
