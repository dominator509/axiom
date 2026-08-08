import { rmSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';

const targets = process.argv.slice(2);

if (targets.length === 0) {
  throw new Error('clean: at least one relative build-output path is required');
}

const cwd = resolve(process.cwd());

for (const target of targets) {
  const normalized = normalize(target);
  if (
    isAbsolute(target) ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`) ||
    normalized === '.'
  ) {
    throw new Error(`clean: refusing unsafe target path: ${target}`);
  }

  const destination = resolve(cwd, normalized);
  if (!destination.startsWith(`${cwd}${sep}`)) {
    throw new Error(`clean: target escapes package directory: ${target}`);
  }

  rmSync(destination, { recursive: true, force: true });
  console.log(`clean: removed ${target}`);
}
