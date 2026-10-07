// Evidence completeness gate. It does not replace review of the underlying tests.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const documents = [
  'L5-verification/L5.0-test-matrix.md',
  'L5-verification/L5.2-acceptance-and-security-audit.md',
];
const invariantDocument = 'L0-governance/L0.0-governance-and-invariants.md';
const invariantCrosswalkDocument = 'L5-verification/release-evidence-invariant-crosswalk.json';
const sha = /^[a-f0-9]{40}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const repository = 'https://github.com/dominator509/axiom';

// Read requirements, never dated checkpoint prose. Exact text binding makes
// additions, removals and edits visible in review instead of silently omitting them.
export function requirements(read) {
  const result = [];
  for (const file of documents) {
    let section = '';
    let ordinal = 0;
    const lines = read(file).split(/\r?\n/);
    for (const line of lines) {
      const heading = /^## (\d+)\./.exec(line);
      if (heading) { section = heading[1]; ordinal = 0; }
      if (/^## Current checkpoint/.test(line)) section = '';
      let id;
      if (file === documents[0]) {
        const row = /^\| (LBI-\d{2}|A\d+) \|/.exec(line);
        if (row && ['1', '2'].includes(section)) id = row[1];
        if (section === '3' && line.startsWith('A checklist test')) id = 'FEATURE-PRESERVATION';
        if (section === '4' && line.startsWith('- ')) id = `MATRIX-NFR-${++ordinal}`;
        if (section === '5' && line.startsWith('All of')) id = 'MATRIX-CI';
      } else {
        if (['1', '2', '3'].includes(section) && /^- \[[ x]\] /.test(line)) {
          id = `${{ 1: 'FUNCTIONAL', 2: 'NONFUNCTIONAL', 3: 'SECURITY' }[section]}-${++ordinal}`;
        }
        if (section === '4' && line.startsWith('Release is authorized')) id = 'HUMAN-SIGNOFF';
      }
      if (id) result.push({ id, source: file, requirement: line, requirementSha256: digest(line) });
    }
  }
  check(result.length > 40, 'Requirement extraction incomplete');
  check(new Set(result.map(row => row.id)).size === result.length, 'Duplicate requirement IDs');

  const canonicalInvariants = [...read(invariantDocument).matchAll(/^\*\*LBI-(\d{2}) — ([^.]+)\./gm)]
    .map(([, id, property]) => ({ id: `LBI-${id}`, property }));
  check(canonicalInvariants.length === 12 && canonicalInvariants.every((item, index) =>
    item.id === `LBI-${String(index + 1).padStart(2, '0')}` && nonempty(item.property)),
  'Canonical LBI catalog must define LBI-01 through LBI-12 exactly once');
  const matrixInvariants = read('L5-verification/L5.0-test-matrix.md').split(/\r?\n/)
    .map(line => /^\| (LBI-\d{2}) \| ([^|]+) \|/.exec(line))
    .filter(Boolean)
    .map(([, id, property]) => ({ id, property: property.trim() }));
  check(JSON.stringify(matrixInvariants) === JSON.stringify(canonicalInvariants),
    'L5.0 invariant numbering or properties differ from the canonical L0 catalog');

  const crosswalk = JSON.parse(read(invariantCrosswalkDocument));
  check(crosswalk?.version === 1, 'invariant crosswalk: unsupported version');
  check(crosswalk.canonicalSource === invariantDocument, 'invariant crosswalk: wrong canonical source');
  check(JSON.stringify(crosswalk.invariants) === JSON.stringify(canonicalInvariants),
    'invariant crosswalk: canonical invariant definitions differ');
  const crosswalkRows = crosswalk.criteria;
  const ids = result.map(row => row.id);
  check(crosswalkRows && typeof crosswalkRows === 'object' && !Array.isArray(crosswalkRows) &&
    Object.keys(crosswalkRows).length === ids.length && ids.every(id => Object.hasOwn(crosswalkRows, id)),
  'invariant crosswalk: criterion coverage mismatch');
  const byId = new Map(canonicalInvariants.map(item => [item.id, item]));
  for (const row of result) {
    const entry = crosswalkRows[row.id];
    check(entry && Array.isArray(entry.invariants), `${row.id}: invariant crosswalk entry missing`);
    check(entry.invariants.every(id => byId.has(id)) && new Set(entry.invariants).size === entry.invariants.length,
      `${row.id}: invariant crosswalk contains an unknown or duplicate invariant`);
    const cited = [...new Set([...row.requirement.matchAll(/\bLBI-(\d{2})\b/g)]
      .map(([, id]) => `LBI-${id}`))];
    const orderedCitations = canonicalInvariants.map(item => item.id).filter(id => cited.includes(id));
    check(JSON.stringify(entry.invariants) === JSON.stringify(orderedCitations),
      `${row.id}: invariant crosswalk differs from normative requirement citations`);
    check(entry.classification === (entry.invariants.length ? 'invariant-linked' : 'independent-acceptance'),
      `${row.id}: invariant crosswalk classification mismatch`);
    row.canonicalInvariantProperties = entry.invariants.map(id => byId.get(id));
  }
  return result;
}

export function validate(register, expected, { releaseSha, verifySha } = {}) {
  const release = releaseSha !== undefined;
  const receiptSha = releaseSha ?? verifySha;
  if (release) check(typeof releaseSha === 'string' && sha.test(releaseSha), 'Release requires full immutable SHA');
  if (verifySha !== undefined) check(typeof verifySha === 'string' && sha.test(verifySha), 'Receipt verification requires full immutable SHA');
  check(!(release && verifySha !== undefined), 'Choose release or receipt verification, not both');
  check(register?.version === 1, 'Unsupported evidence register version');
  check(sha.test(register.baselineSha), 'Invalid baseline SHA');
  check(Array.isArray(register.criteria), 'Missing criteria');
  check(register.criteria.length === expected.length, 'Requirement coverage differs from L5');
  const seen = new Set();
  for (const row of register.criteria) {
    check(!seen.has(row.id), 'Duplicate criterion');
    seen.add(row.id);
    const requirement = expected.find(item => item.id === row.id);
    check(requirement, 'Unknown criterion');
    for (const key of ['source', 'requirement', 'requirementSha256']) {
      check(row[key] === requirement[key], `${row.id}: requirement changed; reconcile evidence`);
    }
    check(['passed', 'failed', 'blocked', 'unverified'].includes(row.status), `${row.id}: invalid status`);
    check(nonempty(row.nextStep), `${row.id}: missing next step`);
    check(Number.isInteger(row.lane) && row.lane >= 1 && row.lane <= 8, `${row.id}: invalid lane`);
    const verification = row.verification;
    check(nonempty(verification?.test), `${row.id}: missing planned test`);
    check(nonempty(verification?.environment), `${row.id}: missing planned environment`);
    check(Array.isArray(verification?.dependencies)
      && verification.dependencies.every(lane => Number.isInteger(lane) && lane >= 1 && lane < row.lane),
    `${row.id}: invalid lane dependencies`);
    check(Array.isArray(verification?.requiredEvidence)
      && verification.requiredEvidence.length > 0 && verification.requiredEvidence.every(nonempty),
    `${row.id}: missing required evidence`);
    check(nonempty(verification?.completionCondition), `${row.id}: missing completion condition`);
    check(Array.isArray(requirement.canonicalInvariantProperties), `${row.id}: missing canonical invariant mapping`);
    check(requirement.canonicalInvariantProperties.every(item =>
      /^LBI-\d{2}$/.test(item.id) && nonempty(item.property)), `${row.id}: invalid canonical invariant mapping`);
    check(Array.isArray(row.evidence), `${row.id}: missing evidence array`);
    if (row.status === 'passed') check(row.evidence.length > 0, `${row.id}: evidence-free pass`);
    for (const receipt of row.evidence) {
      check(sha.test(receipt.sha), `${row.id}: invalid receipt SHA`);
      check(receipt.criterion === row.id, `${row.id}: receipt belongs to another criterion`);
      for (const key of ['command', 'environment', 'scope', 'limitations', 'observedAt', 'logSha256']) {
        check(nonempty(receipt[key]), `${row.id}: missing receipt ${key}`);
      }
      check(Number.isFinite(Date.parse(receipt.observedAt)), `${row.id}: invalid observation date`);
      check(/^[a-f0-9]{64}$/.test(receipt.logSha256), `${row.id}: invalid log digest`);
      check(/^https:\/\/github\.com\/dominator509\/axiom\/actions\/runs\/[1-9]\d*$/.test(receipt.ciUrl), `${row.id}: invalid CI URL`);
      check(typeof receipt.jobUrl === 'string' && receipt.jobUrl.startsWith(`${receipt.ciUrl}/job/`) &&
        /^[1-9]\d*$/.test(receipt.jobUrl.slice(`${receipt.ciUrl}/job/`.length)), `${row.id}: job must belong to run`);
      const counts = receipt.counts;
      check(counts && ['passed', 'failed', 'skipped', 'total'].every(key => integer(counts[key])), `${row.id}: missing full counts`);
      check(counts.total > 0 && counts.total === counts.passed + counts.failed + counts.skipped, `${row.id}: inconsistent counts`);
      check(['tests', 'assertions', 'checks'].includes(counts.unit), `${row.id}: missing count unit`);
      check(Array.isArray(receipt.skips) && receipt.skips.length === counts.skipped && receipt.skips.every(nonempty), `${row.id}: undocumented skips`);
      check(Array.isArray(receipt.images) && receipt.images.every(image =>
        /^.+@sha256:[a-f0-9]{64}$/.test(image) || /^sha256:[a-f0-9]{64}$/.test(image)), `${row.id}: invalid image provenance`);
      if (row.status === 'passed') check(counts.failed === 0 && counts.passed > 0, `${row.id}: failing pass receipt`);
    }
    if (receiptSha !== undefined && row.status === 'passed') {
      const matchingReceipts = row.evidence.filter(receipt => receipt.sha === receiptSha);
      check(matchingReceipts.length > 0, `${row.id}: stale evidence SHA`);
      for (const receipt of matchingReceipts) {
        check(receipt.counts.skipped === 0, `${row.id}: skipped acceptance`);
      }
    }
  }
  if (verifySha !== undefined) {
    check(register.criteria.some(row => row.status === 'passed'), 'Receipt verification blocked: no passed criteria');
    check(register.criteria.every(row => row.evidence.length === 0 || row.status === 'passed'),
      'Receipt verification blocked: evidence attached to a non-passed criterion');
  }
  if (release) {
    check(register.criteria.every(row => row.status === 'passed'), 'Release blocked: open acceptance criteria');
    check(register.signoff?.sha === releaseSha && nonempty(register.signoff.owner) &&
      nonempty(register.signoff.reference), 'Release blocked: missing owner sign-off for this SHA');
  }
  return { criteria: seen.size, passed: register.criteria.filter(row => row.status === 'passed').length };
}

export function verifyHosted(register, releaseSha, gh, readLog) {
  const passedRows = register.criteria.filter(row => row.status === 'passed');
  const receipts = passedRows.flatMap(row => {
    const matching = row.evidence.filter(receipt => receipt.sha === releaseSha);
    check(matching.length > 0, `${row.id}: stale evidence SHA`);
    check(matching.every(receipt => receipt.counts?.failed === 0 && receipt.counts?.skipped === 0),
      `${row.id}: failed or skipped acceptance`);
    return matching;
  });
  const runs = new Map();
  const jobs = new Map();
  for (const receipt of receipts) {
    const runId = receipt.ciUrl.split('/').at(-1);
    if (!runs.has(runId)) {
      const run = gh(`repos/dominator509/axiom/actions/runs/${runId}`);
      check(run.head_sha === releaseSha && run.status === 'completed' && run.conclusion === 'success', 'Hosted run is stale, incomplete or not green');
      check(run.html_url === `${repository}/actions/runs/${runId}`, 'Hosted run URL mismatch');
      runs.set(runId, run);
    }
    const jobId = receipt.jobUrl.split('/').at(-1);
    if (!jobs.has(jobId)) jobs.set(jobId, {
      metadata: gh(`repos/dominator509/axiom/actions/jobs/${jobId}`),
      logDigest: digest(readLog(`repos/dominator509/axiom/actions/jobs/${jobId}/logs`)),
    });
    const { metadata: job, logDigest } = jobs.get(jobId);
    check(String(job.run_id) === runId && job.head_sha === releaseSha &&
      job.status === 'completed' && job.conclusion === 'success' && job.html_url === receipt.jobUrl,
    'Hosted job is stale, incomplete, unrelated or not green');
    check(logDigest === receipt.logSha256, 'Hosted log digest does not match receipt');
  }
}

export function main(args) {
  const mode = args[0];
  if (mode === '--receipt-log-sha') {
    check(args.length === 2 && /^[1-9]\d*$/.test(args[1]), 'Usage: node scripts/check-release-evidence.mjs --receipt-log-sha <job-id>');
    let rawLog;
    try {
      rawLog = execFileSync('gh', ['api', `repos/dominator509/axiom/actions/jobs/${args[1]}/logs`], {
        timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch { throw new Error('Hosted log unavailable; receipt digest not generated'); }
    console.log(digest(rawLog));
    return;
  }
  const release = args[0] === '--release';
  const verifyReceipts = args[0] === '--verify-receipts';
  check(args.length === (release || verifyReceipts ? 2 : 1) && (release || verifyReceipts || args[0] === '--check'),
    'Usage: node scripts/check-release-evidence.mjs --check | --verify-receipts <full-sha> | --receipt-log-sha <job-id> | --release <full-sha>');
  const root = new URL('../', import.meta.url);
  const read = file => readFileSync(new URL(file, root), 'utf8');
  const register = JSON.parse(read('L5-verification/release-evidence.json'));
  const targetSha = release || verifyReceipts ? args[1] : undefined;
  const result = validate(register, requirements(read), {
    releaseSha: release ? args[1] : undefined,
    verifySha: verifyReceipts ? args[1] : undefined,
  });
  const gh = endpoint => {
    // Never display gh stderr: authentication diagnostics can contain private data.
    try {
      return execFileSync('gh', ['api', endpoint], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch { throw new Error('Hosted receipt unavailable; release blocked'); }
  };
  if (release || verifyReceipts) verifyHosted(register, targetSha, endpoint => JSON.parse(gh(endpoint).toString('utf8')), gh);
  const outcome = release
    ? 'release evidence complete; human review still required'
    : verifyReceipts
      ? `hosted receipts verified at ${targetSha}; NOT release approval`
      : 'register valid; NOT release approval';
  console.log(`release-evidence: ${result.criteria} criteria, ${result.passed} accepted, ${result.criteria - result.passed} open; ${outcome}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
