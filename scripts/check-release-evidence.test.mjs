import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requirements, validate, verifyHosted } from './check-release-evidence.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const expected = requirements(read);
const current = JSON.parse(read('L5-verification/release-evidence.json'));
const releaseSha = 'a'.repeat(40);
const ciUrl = 'https://github.com/dominator509/axiom/actions/runs/123';
const jobUrl = `${ciUrl}/job/456`;
function complete() {
  const register = structuredClone(current);
  register.signoff = { sha: releaseSha, owner: 'Synthetic test owner', reference: 'Test-only signed acceptance record' };
  for (const row of register.criteria) {
    row.status = 'passed';
    row.evidence = [{ criterion: row.id, sha: releaseSha, command: 'test-only command',
      environment: 'synthetic validator input', scope: row.id, limitations: 'Validator regression only',
      observedAt: '2026-10-03T00:00:00Z', logSha256: createHash('sha256').update('test log').digest('hex'), ciUrl, jobUrl,
      counts: { passed: 1, failed: 0, skipped: 0, total: 1, unit: 'assertions' }, skips: [], images: [] }];
  }
  return register;
}

test('current register is structurally complete without implying release acceptance', () => {
  assert.equal(validate(current, expected).criteria, expected.length);
  assert.throws(() => validate(current, expected, { releaseSha }), /Release blocked/);
});
test('complete synthetic evidence is accepted by the structural release validator', () => {
  assert.equal(validate(complete(), expected, { releaseSha }).passed, expected.length);
});
for (const value of ['', null, 'main', 'abcd123']) test(`release rejects invalid SHA ${JSON.stringify(value)}`, () => {
  assert.throws(() => validate(current, expected, { releaseSha: value }), /immutable SHA/);
});
for (const [name, mutate] of [
  ['missing criterion', r => r.criteria.pop()],
  ['duplicate criterion', r => { r.criteria[1] = r.criteria[0]; }],
  ['changed requirement', r => { r.criteria[0].requirement += ' relaxed'; }],
  ['changed source digest', r => { r.criteria[0].requirementSha256 = '0'.repeat(64); }],
  ['unknown status', r => { r.criteria[0].status = 'done'; }],
  ['evidence-free pass', r => { r.criteria[0].evidence = []; }],
  ['missing command', r => { delete r.criteria[0].evidence[0].command; }],
  ['missing scope', r => { delete r.criteria[0].evidence[0].scope; }],
  ['missing logs', r => { delete r.criteria[0].evidence[0].logSha256; }],
  ['missing counts', r => { delete r.criteria[0].evidence[0].counts.skipped; }],
  ['job totals mislabeled as tests', r => { r.criteria[0].evidence[0].counts.unit = 'jobs'; }],
  ['negative counts', r => { r.criteria[0].evidence[0].counts.failed = -1; }],
  ['incorrect totals', r => { r.criteria[0].evidence[0].counts.total = 2; }],
  ['failure in passed receipt', r => { r.criteria[0].evidence[0].counts = { passed: 0, failed: 1, skipped: 0, total: 1, unit: 'tests' }; }],
  ['undocumented skip', r => { r.criteria[0].evidence[0].counts = { passed: 1, failed: 0, skipped: 1, total: 2, unit: 'tests' }; }],
  ['wrong repository', r => { r.criteria[0].evidence[0].ciUrl = ciUrl.replace('axiom', 'other'); }],
  ['job from different run', r => { r.criteria[0].evidence[0].jobUrl = jobUrl.replace('/123/', '/789/'); }],
  ['receipt for different criterion', r => { r.criteria[0].evidence[0].criterion = 'OTHER'; }],
  ['mutable image tag', r => { r.criteria[0].evidence[0].images = ['test:latest']; }],
]) test(`rejects ${name}`, () => {
  const register = complete();
  mutate(register);
  assert.throws(() => validate(register, expected));
});

for (const [name, mutate] of [
  ['historical SHA', r => { r.criteria[0].evidence[0].sha = 'c'.repeat(40); }],
  ['documented skip', r => { const e = r.criteria[0].evidence[0]; e.counts.skipped = 1; e.counts.total = 2; e.skips = ['Unexecuted acceptance']; }],
  ['missing signoff', r => { delete r.signoff; }],
  ['stale signoff', r => { r.signoff.sha = 'c'.repeat(40); }],
  ['open criterion', r => { r.criteria[0].status = 'blocked'; }],
]) test(`release rejects ${name}`, () => {
  const register = complete();
  mutate(register);
  assert.throws(() => validate(register, expected, { releaseSha }));
});

function hosted(endpoint) {
  return endpoint.includes('/jobs/')
    ? { run_id: 123, head_sha: releaseSha, status: 'completed', conclusion: 'success', html_url: jobUrl }
    : { head_sha: releaseSha, status: 'completed', conclusion: 'success', html_url: ciUrl };
}
test('hosted readback accepts matching successful run and job', () => {
  verifyHosted(complete(), releaseSha, hosted, () => Buffer.from('test log'));
});
for (const [name, field, value] of [
  ['wrong source', 'head_sha', 'c'.repeat(40)],
  ['cancelled job', 'conclusion', 'cancelled'],
  ['pending job', 'status', 'in_progress'],
  ['unrelated run', 'run_id', 789],
  ['wrong job URL', 'html_url', `${ciUrl}/job/789`],
]) test(`hosted readback rejects ${name}`, () => {
  assert.throws(() => verifyHosted(complete(), releaseSha, endpoint => {
    const response = hosted(endpoint);
    if (endpoint.includes('/jobs/')) response[field] = value;
    return response;
  }, () => Buffer.from('test log')));
});
test('unavailable hosted evidence fails closed', () => {
  assert.throws(() => verifyHosted(complete(), releaseSha, () => { throw new Error('Unavailable'); }));
});
test('altered hosted log fails closed', () => {
  assert.throws(() => verifyHosted(complete(), releaseSha, hosted, () => Buffer.from('altered log')), /digest/);
});
test('expired or unavailable hosted logs fail closed', () => {
  assert.throws(() => verifyHosted(complete(), releaseSha, hosted, () => { throw new Error('Expired log'); }));
});
