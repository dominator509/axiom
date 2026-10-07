import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requirements, validate, verifyHosted } from './check-release-evidence.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const expected = requirements(read);
const current = JSON.parse(read('L5-verification/release-evidence.json'));
const invariantCrosswalkFile = 'L5-verification/release-evidence-invariant-crosswalk.json';
const invariantCrosswalk = JSON.parse(read(invariantCrosswalkFile));
const releaseSha = 'a'.repeat(40);
const currentSha = current.baselineSha;
const ciUrl = 'https://github.com/dominator509/axiom/actions/runs/123';
const jobUrl = `${ciUrl}/job/456`;
function empty() {
  const register = structuredClone(current);
  for (const row of register.criteria) { row.status = 'unverified'; row.evidence = []; }
  return register;
}
function complete() {
  const register = empty();
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
const incrementalIds = new Set(['LBI-01', 'NONFUNCTIONAL-2', 'SECURITY-2']);
function incremental() {
  const register = empty();
  for (const row of register.criteria) if (incrementalIds.has(row.id)) {
    row.status = 'passed';
    row.evidence = [{ criterion: row.id, sha: releaseSha, command: 'node scripts/rehearse-rls-catalog.mjs --isolated-fixture',
      environment: 'synthetic validator input', scope: row.id, limitations: 'Validator regression only',
      observedAt: '2026-10-03T00:00:00Z', logSha256: createHash('sha256').update('test log').digest('hex'), ciUrl, jobUrl,
      counts: { passed: 20, failed: 0, skipped: 0, total: 20, unit: 'assertions' }, skips: [], images: [] }];
  }
  return register;
}

test('current register is structurally complete without implying release acceptance', () => {
  assert.equal(validate(current, expected).criteria, expected.length);
  assert.equal(validate(current, expected).passed, 5);
  assert.throws(() => validate(current, expected, { releaseSha: currentSha }));
});
test('accepts an immutable local Docker image ID as image provenance', () => {
  const register = complete();
  register.criteria[0].evidence[0].images = [`sha256:${'a'.repeat(64)}`];
  assert.doesNotThrow(() => validate(register, expected));
});
test('L5 invariant rows use the canonical L0 property names and cover every invariant', () => {
  const canonical = [...read('L0-governance/L0.0-governance-and-invariants.md').matchAll(/^\*\*LBI-(\d{2}) — ([^.]+)\./gm)]
    .map(([, id, property]) => [`LBI-${id}`, property]);
  const matrix = read('L5-verification/L5.0-test-matrix.md').split(/\r?\n/)
    .map(line => /^\| (LBI-\d{2}) \| ([^|]+) \|/.exec(line))
    .filter(Boolean)
    .map(([, id, property]) => [id, property.trim()]);
  assert.deepEqual(matrix, canonical);
  const approval = expected.find(row => row.id === 'LBI-04').requirement;
  assert.match(approval, /forged, expired, and replayed commands are rejected and logged/);
});
test('every acceptance row maps to canonical invariant properties or explicit independent acceptance', () => {
  const canonical = [...read('L0-governance/L0.0-governance-and-invariants.md').matchAll(/^\*\*LBI-(\d{2}) — ([^.]+)\./gm)]
    .map(([, id, property]) => ({ id: `LBI-${id}`, property }));
  assert.deepEqual(invariantCrosswalk.invariants, canonical);
  assert.equal(Object.keys(invariantCrosswalk.criteria).length, expected.length);
  for (const row of expected) {
    const mapping = invariantCrosswalk.criteria[row.id];
    assert.ok(mapping, row.id);
    assert.ok(Array.isArray(mapping.invariants), row.id);
    const citations = [...new Set([...row.requirement.matchAll(/\bLBI-(\d{2})\b/g)].map(([, id]) => `LBI-${id}`))];
    const canonicalCitations = canonical.map(item => item.id).filter(id => citations.includes(id));
    assert.deepEqual(mapping.invariants, canonicalCitations, row.id);
    assert.equal(mapping.classification, citations.length ? 'invariant-linked' : 'independent-acceptance', row.id);
    assert.deepEqual(row.canonicalInvariantProperties, canonical.filter(item => citations.includes(item.id)), row.id);
  }
});
for (const [name, mutate, message] of [
  ['missing criterion', crosswalk => { delete crosswalk.criteria.A1; }, /criterion coverage mismatch/],
  ['canonical property drift', crosswalk => { crosswalk.invariants[0].property = 'Wrong property'; }, /canonical invariant definitions differ/],
  ['missing cited invariant', crosswalk => { crosswalk.criteria['LBI-02'].invariants = []; }, /normative requirement citations/],
  ['unknown invariant', crosswalk => { crosswalk.criteria.A1.invariants = ['LBI-99']; crosswalk.criteria.A1.classification = 'invariant-linked'; }, /unknown or duplicate invariant/],
  ['incorrect classification', crosswalk => { crosswalk.criteria.A1.classification = 'invariant-linked'; }, /classification mismatch/],
]) test(`crosswalk rejects ${name}`, () => {
  const changed = structuredClone(invariantCrosswalk);
  mutate(changed);
  const readChanged = file => file === invariantCrosswalkFile ? JSON.stringify(changed) : read(file);
  assert.throws(() => requirements(readChanged), message);
});
test('evidence extraction rejects L5 invariant numbering or property drift', () => {
  const readChanged = file => file === 'L5-verification/L5.0-test-matrix.md'
    ? read(file).replace('| LBI-01 | Tenant isolation |', '| LBI-01 | Renamed tenant isolation |')
    : read(file);
  assert.throws(() => requirements(readChanged), /L5\.0 invariant numbering or properties/);
});
test('complete synthetic evidence is accepted by the structural release validator', () => {
  assert.equal(validate(complete(), expected, { releaseSha }).passed, expected.length);
});
test('every acceptance row has a test, environment, dependencies, evidence and completion condition', () => {
  const register = empty();
  assert.equal(validate(register, expected).criteria, expected.length);
  for (const row of register.criteria) {
    assert.ok(row.verification.test.length > 0, row.id);
    assert.ok(row.verification.environment.length > 0, row.id);
    assert.ok(Array.isArray(row.verification.dependencies), row.id);
    assert.ok(row.verification.requiredEvidence.length > 0, row.id);
    assert.ok(row.verification.completionCondition.length > 0, row.id);
    assert.ok(row.verification.dependencies.every(lane => lane < row.lane), row.id);
  }
});
test('incremental exact-SHA evidence validates without closing open release rows', () => {
  const register = incremental();
  assert.equal(validate(register, expected, { verifySha: releaseSha }).passed, incrementalIds.size);
  assert.equal(register.criteria.filter(row => row.status === 'unverified').length, expected.length - incrementalIds.size);
  assert.throws(() => validate(register, expected, { releaseSha }), /Release blocked/);
  verifyHosted(register, releaseSha, hosted, () => Buffer.from('test log'));
});
test('incremental verification rejects stale or skipped evidence', () => {
  const stale = incremental();
  stale.criteria.find(row => row.id === 'LBI-01').evidence[0].sha = 'c'.repeat(40);
  assert.throws(() => validate(stale, expected, { verifySha: releaseSha }), /stale evidence SHA/);
  const skipped = incremental();
  skipped.criteria.find(row => row.id === 'LBI-01').evidence[0].counts.skipped = 1;
  skipped.criteria.find(row => row.id === 'LBI-01').evidence[0].counts.total = 21;
  skipped.criteria.find(row => row.id === 'LBI-01').evidence[0].skips = ['not run'];
  assert.throws(() => validate(skipped, expected, { verifySha: releaseSha }), /skipped acceptance/);
});
test('exact-SHA verification preserves unrelated historical receipts', () => {
  const register = incremental();
  const row = register.criteria.find(item => item.id === 'LBI-01');
  row.evidence.unshift({ ...row.evidence[0], sha: 'c'.repeat(40) });
  assert.equal(validate(register, expected, { verifySha: releaseSha }).passed, incrementalIds.size);
});
test('incremental verification requires an accepted row and no evidence on open rows', () => {
  assert.throws(() => validate(empty(), expected, { verifySha: releaseSha }), /no passed criteria/);
  const register = incremental();
  const open = register.criteria.find(row => row.id === 'LBI-03');
  open.evidence = [{ ...register.criteria.find(row => row.id === 'LBI-01').evidence[0], criterion: open.id }];
  assert.throws(() => validate(register, expected, { verifySha: releaseSha }), /non-passed criterion/);
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
  ['missing planned test', r => { delete r.criteria[0].verification.test; }],
  ['missing planned environment', r => { delete r.criteria[0].verification.environment; }],
  ['invalid lane dependency', r => { r.criteria[0].verification.dependencies = [r.criteria[0].lane]; }],
  ['missing required evidence', r => { r.criteria[0].verification.requiredEvidence = []; }],
  ['missing completion condition', r => { delete r.criteria[0].verification.completionCondition; }],
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
test('hosted readback selects target-SHA receipts while retaining other history', () => {
  const register = complete();
  const row = register.criteria.find(item => item.id === 'LBI-01');
  row.evidence.unshift({ ...row.evidence[0], sha: 'c'.repeat(40),
    ciUrl: 'https://github.com/dominator509/axiom/actions/runs/789',
    jobUrl: 'https://github.com/dominator509/axiom/actions/runs/789/job/987' });
  const requests = [];
  verifyHosted(register, releaseSha, endpoint => {
    requests.push(endpoint);
    return hosted(endpoint);
  }, () => Buffer.from('test log'));
  assert.deepEqual(requests, [
    'repos/dominator509/axiom/actions/runs/123',
    'repos/dominator509/axiom/actions/jobs/456',
  ]);
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
