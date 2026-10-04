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
        const row = /^\| (\d{2}|A\d+) \|/.exec(line);
        if (row && ['1', '2'].includes(section)) id = row[1].startsWith('A') ? row[1] : `LBI-${row[1]}`;
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
  return result;
}

export function validate(register, expected, { releaseSha } = {}) {
  const release = releaseSha !== undefined;
  if (release) check(typeof releaseSha === 'string' && sha.test(releaseSha), 'Release requires full immutable SHA');
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
      check(Array.isArray(receipt.images) && receipt.images.every(image => /^.+@sha256:[a-f0-9]{64}$/.test(image)), `${row.id}: invalid image provenance`);
      if (row.status === 'passed') check(counts.failed === 0 && counts.passed > 0, `${row.id}: failing pass receipt`);
      if (release && row.status === 'passed') {
        check(receipt.sha === releaseSha, `${row.id}: stale release evidence`);
        check(counts.skipped === 0, `${row.id}: skipped release acceptance`);
      }
    }
  }
  if (release) {
    check(register.criteria.every(row => row.status === 'passed'), 'Release blocked: open acceptance criteria');
    check(register.signoff?.sha === releaseSha && nonempty(register.signoff.owner) &&
      nonempty(register.signoff.reference), 'Release blocked: missing owner sign-off for this SHA');
  }
  return { criteria: seen.size, passed: register.criteria.filter(row => row.status === 'passed').length };
}

export function verifyHosted(register, releaseSha, gh, readLog) {
  const receipts = register.criteria.flatMap(row => row.evidence);
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
  const release = args[0] === '--release';
  check(args.length === (release ? 2 : 1) && (release || args[0] === '--check'),
    'Usage: node scripts/check-release-evidence.mjs --check | --release <full-sha>');
  const root = new URL('../', import.meta.url);
  const read = file => readFileSync(new URL(file, root), 'utf8');
  const register = JSON.parse(read('L5-verification/release-evidence.json'));
  const result = validate(register, requirements(read), { releaseSha: release ? args[1] : undefined });
  const gh = endpoint => {
    // Never display gh stderr: authentication diagnostics can contain private data.
    try {
      return execFileSync('gh', ['api', endpoint], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch { throw new Error('Hosted receipt unavailable; release blocked'); }
  };
  if (release) verifyHosted(register, args[1], endpoint => JSON.parse(gh(endpoint).toString('utf8')), gh);
  console.log(`release-evidence: ${result.criteria} criteria, ${result.passed} accepted, ${result.criteria - result.passed} open; ${release ? 'release evidence complete; human review still required' : 'register valid; NOT release approval'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
