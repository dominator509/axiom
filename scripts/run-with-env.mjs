import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('run-with-env: command is required');
}
const allowedCommands = new Set(['pnpm', 'cargo']);
if (!allowedCommands.has(command)) {
  throw new Error(`run-with-env: unsupported command: ${command}`);
}
if (args.some((arg) => !/^[A-Za-z0-9@._*:/=+,-]+$/.test(arg))) {
  throw new Error('run-with-env: unsafe command argument');
}

// Node's parser follows dotenv syntax without evaluating shell expressions.
// Values are inherited by the child process and are never printed here.
if (existsSync('.env')) {
  loadEnvFile('.env');
}

const useWindowsCommandShim = process.platform === 'win32' && command === 'pnpm';
const executable = useWindowsCommandShim ? 'pnpm.cmd' : command;
const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  // Windows requires cmd.exe to launch a .cmd shim. The strict command and
  // argument allowlists above prevent shell metacharacter injection.
  shell: useWindowsCommandShim,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
