// Mechanical checkout normalization only: preserve SQL text and Git blob bytes.
// Pinning LF makes the existing byte-based ledger portable across checkout OSes.
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.argv[2], '--fix-checkout');
const directory = new URL('../packages/db/migrations/', import.meta.url);
let normalized = 0;
for (const name of readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name))) {
  const path = new URL(name, directory);
  assert.ok(lstatSync(path).isFile());
  const text = readFileSync(path, 'utf8');
  assert.ok(!/\r(?!\n)/.test(text), 'Unexpected bare carriage return in SQL');
  if (text.includes('\r\n')) {
    writeFileSync(path, text.replace(/\r\n/g, '\n'));
    normalized++;
  }
}
console.log(`Normalized ${normalized} migration checkout files to canonical LF`);
