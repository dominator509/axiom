import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

function assertEnvEntry(key: string, value: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error('Invalid environment key');
  }
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid credential value for ${key}`);
  }
}

/**
 * Update secrets in an existing, bootstrap-hardened environment file.
 *
 * The function deliberately refuses to create the credential file. On POSIX
 * it uses a mode-0600 sibling and atomic rename. On Windows it rewrites the
 * existing file in place so its explicit ACL is retained.
 */
export function persistEnvValues(filePath: string, values: Record<string, string>): void {
  const original = readFileSync(filePath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let lines = original.split(/\r?\n/);

  for (const [key, value] of Object.entries(values)) {
    assertEnvEntry(key, value);
    const prefix = `${key}=`;
    const first = lines.findIndex((line) => line.startsWith(prefix));
    lines = lines.filter((line, index) => !line.startsWith(prefix) || index === first);
    const entry = `${prefix}${value}`;
    if (first >= 0) lines[first] = entry;
    else lines.push(entry);
  }

  const content = lines.join(newline);
  if (process.platform === 'win32') {
    writeFileSync(filePath, content);
    return;
  }

  const temporary = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, filePath);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The file may not have been created or may already have been renamed.
    }
    throw error;
  }
}
