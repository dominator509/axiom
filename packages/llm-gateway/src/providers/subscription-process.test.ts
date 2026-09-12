import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitForLinuxProcessGroup } from './subscription-process.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'axiom-proc-')); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });
function stat(pid: number, group: number, state: string) {
  mkdirSync(join(root, String(pid)), { recursive: true });
  writeFileSync(join(root, String(pid), 'stat'), `${pid} (name with ) parentheses) ${state} 1 ${group} 0`);
}
it('waits for executing descendants even after the wrapper disappears', async () => {
  stat(102, 100, 'R');
  let finished = false;
  const pending = waitForLinuxProcessGroup(100, root).then(result => { finished = true; return result; });
  await vi.advanceTimersByTimeAsync(100);
  expect(finished).toBe(false);
  stat(102, 100, 'Z');
  await vi.advanceTimersByTimeAsync(10);
  expect(await pending).toBe(true);
});
it('fails closed when a group member remains live beyond the deadline', async () => {
  stat(102, 100, 'S');
  const pending = waitForLinuxProcessGroup(100, root);
  await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toBe(false);
});
it('ignores unrelated groups and processes reaped during enumeration', async () => {
  stat(102, 101, 'R');
  mkdirSync(join(root, '103'));
  expect(await waitForLinuxProcessGroup(100, root)).toBe(true);
});
it('does not infer successful termination from unavailable process state', async () => {
  expect(await waitForLinuxProcessGroup(100, join(root, 'missing'))).toBe(false);
  mkdirSync(join(root, '102'));
  writeFileSync(join(root, '102', 'stat'), 'invalid');
  expect(await waitForLinuxProcessGroup(100, root)).toBe(false);
});
