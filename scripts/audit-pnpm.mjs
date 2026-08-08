import { spawnSync } from 'node:child_process';

const patchedAdvisories = new Map([
  ['GHSA-w3rx-r6r6-pgpr', 'image-size'],
  ['GHSA-5p2g-fcmc-qvqq', 'image-size'],
]);

const regression = spawnSync(process.execPath, ['scripts/test-patched-dependencies.mjs'], {
  encoding: 'utf8',
});
if (regression.status !== 0) {
  console.error('pnpm-audit: fail - patched dependency regression did not pass');
  if (regression.stdout.trim()) console.error(regression.stdout.trim());
  if (regression.stderr.trim()) console.error(regression.stderr.trim());
  process.exit(1);
}
console.log('pnpm-audit: security patch regression ok');

const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
const args =
  process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm audit --json'] : ['audit', '--json'];
const result = spawnSync(command, args, { encoding: 'utf8' });

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('pnpm-audit: fail - audit did not return valid JSON');
  if (result.stderr.trim()) console.error(result.stderr.trim());
  process.exit(1);
}

const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const findings = Object.values(report.advisories ?? {}).filter(
  (advisory) => (rank[advisory.severity] ?? 0) >= rank.high,
);
const mitigated = [];
const unmitigated = [];

for (const advisory of findings) {
  const ghsa = advisory.github_advisory_id;
  if (patchedAdvisories.get(ghsa) === advisory.module_name) {
    mitigated.push(advisory);
  } else {
    unmitigated.push(advisory);
  }
}

for (const advisory of mitigated) {
  console.log(
    `pnpm-audit: locally patched - ${advisory.github_advisory_id} (${advisory.module_name})`,
  );
}

if (unmitigated.length > 0) {
  for (const advisory of unmitigated) {
    console.error(
      `pnpm-audit: fail - ${advisory.github_advisory_id ?? advisory.id} (${advisory.module_name}, ${advisory.severity})`,
    );
  }
  process.exit(1);
}

console.log(`pnpm-audit: ok - 0 unmitigated high/critical, ${mitigated.length} locally patched`);
