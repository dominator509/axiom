// Exercise the real phase scripts against disposable ledger/marker fixtures.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'axiom-phase-gates-'));
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';
try {
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, '.agent/state'), { recursive: true });
  for (const script of ['verify.sh', 'graph-next.sh'])
    writeFileSync(join(root, 'scripts', script), readFileSync(new URL(script, import.meta.url)));
  // Only preflight is controlled; phase parsing and marker checks run unchanged.
  writeFileSync(join(root, 'scripts/preflight.sh'), "printf 'preflight: ok\\n'\n");
  for (let phase = 0; phase < 5; phase++) {
    const directory = join(root, `.agent/markers/L4.${phase + 1}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'fixture.done'), 'fixture\n');
  }
  const done = phase => `2026-09-15 | DONE P${phase} - completed`;
  const cases = [
    ['empty', [], 'NEXT P0', 1],
    ['last phase alone', [done(4)], 'NEXT P0', 1],
    ['missing middle phase', [0, 1, 3, 4].map(done), 'NEXT P2', 1],
    ['phase prefix', [done(0).replace('P0 ', 'P00 '), ...[1, 2, 3, 4].map(done)], 'NEXT P0', 1],
    ['prose range', ['2026-09-15 | DONE P0-P4 discussed'], 'NEXT P0', 1],
    ['complete', [0, 1, 2, 3, 4].map(done), 'ALL_DONE', 0],
    ['reordered and duplicate', [4, 2, 0, 1, 3, 0].map(done), 'ALL_DONE', 0],
    ['end of line', [0, 1, 2, 3, 4].map(p => `date | DONE P${p}`), 'ALL_DONE', 0],
  ];
  for (const [name, lines, next, exitCode] of cases) {
    writeFileSync(join(root, '.agent/state/LEDGER.md'), `${lines.join('\n')}\n`);
    for (const script of ['graph-next.sh', 'verify.sh']) {
      const result = spawnSync(shell, [`scripts/${script}`], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000,
      });
      assert.equal(result.status, script === 'graph-next.sh' ? 0 : exitCode,
        `${name}: ${script}: ${result.stdout} ${result.stderr}`);
      if (script === 'graph-next.sh') assert.equal(result.stdout.trim(), next, name);
      else assert.equal(result.stdout.includes('verify: ok'), exitCode === 0, name);
    }
  }
  console.log(`phase-gates: ${cases.length} scenarios passed for both real scripts`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
