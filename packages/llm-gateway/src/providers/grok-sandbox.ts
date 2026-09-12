import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { platform } from 'node:os';
import { ProviderError } from './types.js';

export interface GrokSandboxCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

/** Linux filesystem boundary for one official-CLI media request. Never fall
 * back to a bare executable when namespaces or the runtime are unavailable.
 * The credential directory is separate so the CLI can atomically refresh its
 * own auth file without receiving old sessions, user config, or other users.
 * Network is retained for OAuth/Imagine: this is NOT an egress-policy sandbox.
 */
export function grokSandboxCommand(input: {
  executable: string;
  requestRoot: string;
  credentialRoot: string;
  args: string[];
  imageLauncher?: { executable: string; byteLength: number };
}): GrokSandboxCommand {
  if (platform() !== 'linux' || !existsSync('/usr/bin/bwrap')) {
    throw new ProviderError('Grok media requires the Linux CLI isolation runtime', 503, 'grok');
  }
  if (input.imageLauncher && (!Number.isSafeInteger(input.imageLauncher.byteLength)
    || input.imageLauncher.byteLength < 12 || input.imageLauncher.byteLength > 20 * 1024 * 1024)) {
    throw new ProviderError('Invalid isolated image transfer length', 400, 'grok');
  }
  for (const path of [input.executable, input.requestRoot, input.credentialRoot,
    ...(input.imageLauncher ? [input.imageLauncher.executable] : [])]) {
    if (!isAbsolute(path) || realpathSync(path) !== resolve(path)) {
      throw new ProviderError('Unsafe Grok isolation path', 503, 'grok');
    }
  }
  const args = [
    '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
  ];
  // Only runtime libraries, trust roots and DNS configuration are inherited.
  // In particular: no /, /home, /app, /run, sockets, or caller environment.
  for (const path of ['/lib', '/lib64', '/usr/lib', '/etc/ssl/certs', '/etc/resolv.conf']) {
    if (existsSync(path)) args.push('--ro-bind', path, path);
  }
  if (input.imageLauncher) args.push('--ro-bind', input.imageLauncher.executable, '/grok-input-launch');
  args.push(
    '--ro-bind', input.executable, '/grok',
    '--bind', input.credentialRoot, '/credentials',
    '--bind', input.requestRoot, input.requestRoot,
    '--setenv', 'HOME', input.requestRoot,
    '--setenv', 'GROK_HOME', input.requestRoot,
    '--setenv', 'GROK_AUTH_PATH', '/credentials/auth.json',
    '--setenv', 'GROK_MEMORY', '0',
    '--setenv', 'GROK_DISABLE_AUTOUPDATER', '1',
    '--setenv', 'NO_COLOR', '1', '--setenv', 'CI', '1',
    '--setenv', 'TMPDIR', '/tmp',
    '--chdir', input.requestRoot, '--',
    ...(input.imageLauncher
      ? ['/grok-input-launch', String(input.imageLauncher.byteLength), '--']
      : ['/grok']),
    ...input.args,
  );
  return { command: '/usr/bin/bwrap', args, env: {}, cwd: input.requestRoot };
}
