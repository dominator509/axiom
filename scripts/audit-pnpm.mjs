import { spawnSync } from 'node:child_process';

const patchedAdvisories = new Map([
  ['GHSA-w3rx-r6r6-pgpr', 'image-size'],
  ['GHSA-5p2g-fcmc-qvqq', 'image-size'],
  ['GHSA-vfj7-8cjw-p6xm', 'braces'],
]);

// Narrow exception for the Expo transitive node-forge finding. No fixed npm
// release is published; the upstream fix proposal is not merged yet. Remove
// this entry as soon as a fixed release can be adopted. No other advisory is
// accepted by this exception.
const acceptedUpstreamLimitations = new Map([
  [
    'GHSA-86w9-cpqp-85rv',
    {
      module: 'node-forge',
      reason: 'no published fix; upstream digitalbazaar/forge#1152 remains unmerged',
    },
  ],
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

// This is a verified source patch, not an accepted upstream limitation.
// Missing, altered or bypassed installations must fail before audit classification.
const bracesPatch = spawnSync(process.execPath, ['scripts/check-braces-patch.mjs'], {
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 2 * 1024 * 1024,
});
if (bracesPatch.status !== 0) {
  console.error('pnpm-audit: fail - braces patch verification did not pass');
  if (bracesPatch.stdout) console.error(bracesPatch.stdout.trim());
  if (bracesPatch.stderr) console.error(bracesPatch.stderr.trim());
  process.exit(1);
}
console.log(bracesPatch.stdout.trim());

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
const acceptedLimitations = [];
const unmitigated = [];

for (const advisory of findings) {
  const ghsa = advisory.github_advisory_id;
  if (patchedAdvisories.get(ghsa) === advisory.module_name) {
    mitigated.push(advisory);
    continue;
  }
  const limitation = acceptedUpstreamLimitations.get(ghsa);
  if (limitation?.module === advisory.module_name) {
    acceptedLimitations.push({ advisory, reason: limitation.reason });
  } else {
    unmitigated.push(advisory);
  }
}

for (const advisory of mitigated) {
  console.log(
    `pnpm-audit: locally patched - ${advisory.github_advisory_id} (${advisory.module_name})`,
  );
}

for (const { advisory, reason } of acceptedLimitations) {
  console.log(
    `pnpm-audit: accepted upstream limitation - ${advisory.github_advisory_id} (${advisory.module_name}): ${reason}`,
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

console.log(
  `pnpm-audit: ok - 0 unmitigated high/critical, ${mitigated.length} locally patched, ${acceptedLimitations.length} exact upstream limitation(s)`,
);
