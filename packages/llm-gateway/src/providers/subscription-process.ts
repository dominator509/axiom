import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sending SIGKILL confirms delivery, not completion. Orphaned group members
// may outlive the wrapper's close event; zombies no longer execute or hold FDs.
export async function waitForLinuxProcessGroup(group: number, procRoot = '/proc'): Promise<boolean> {
  const deadline = Date.now() + 1500;
  do {
    let live = false;
    try {
      for (const pid of readdirSync(procRoot)) {
        if (!/^\d+$/.test(pid)) continue;
        let stat: string;
        try { stat = readFileSync(join(procRoot, pid, 'stat'), 'utf8'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          return false;
        }
        const end = stat.lastIndexOf(') ');
        if (end < 0) return false;
        const fields = stat.slice(end + 2).trim().split(/\s+/);
        if (fields.length < 3 || !/^\d+$/.test(fields[2]!)) return false;
        if (Number(fields[2]) === group && !['Z', 'X'].includes(fields[0]!)) live = true;
      }
    } catch { return false; }
    if (!live) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() <= deadline);
  return false;
}
