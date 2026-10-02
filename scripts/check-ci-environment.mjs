import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const expectedNode = readFileSync(new URL('.nvmrc', root), 'utf8').trim();
const expectedPnpm = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  .packageManager.replace('pnpm@', '');
assert.equal(process.versions.node, expectedNode, 'Select the Node release pinned in .nvmrc');
assert.equal(readFileSync(new URL('.node-version', root), 'utf8').trim(), expectedNode,
  'Node version-manager files must agree');
assert.equal(execSync('pnpm --version', { encoding: 'utf8' }).trim(), expectedPnpm,
  'Use the pnpm release pinned in packageManager');
assert.equal(process.env.API_ORIGIN, 'http://127.0.0.1:3001',
  'Development/CI fixture requires API_ORIGIN=http://127.0.0.1:3001');
console.log('environment: ok - Node ' + expectedNode + ', pnpm ' + expectedPnpm +
  ', API_ORIGIN=http://127.0.0.1:3001; dashboard :3000 -> API :3001');
