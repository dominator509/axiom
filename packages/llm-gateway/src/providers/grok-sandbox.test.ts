import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const osPlatform = vi.hoisted(() => vi.fn(() => 'linux'));
const exists = vi.hoisted(() => vi.fn(() => true));
const canonical = vi.hoisted(() => vi.fn());
vi.mock('node:os', () => ({ platform: osPlatform }));
vi.mock('node:fs', () => ({ existsSync: exists, realpathSync: canonical }));
import { grokSandboxCommand } from './grok-sandbox.js';

const input = {
  executable: resolve('/fixture/grok'), requestRoot: resolve('/fixture/request-1'),
  credentialRoot: resolve('/fixture/user-1/credentials'), args: ['--tools', 'image_to_video'],
};
afterEach(() => { vi.resetAllMocks(); osPlatform.mockReturnValue('linux'); exists.mockReturnValue(true); });

describe('Grok Linux request filesystem boundary', () => {
  it('mounts only this request, its credentials and runtime dependencies', () => {
    canonical.mockImplementation(path => resolve(path));
    const command = grokSandboxCommand(input);
    expect(command.command).toBe('/usr/bin/bwrap');
    expect(command.env).toEqual({});
    expect(command.args).toEqual(expect.arrayContaining([
      '--unshare-user', '--unshare-pid', '--die-with-parent', '--new-session', '--clearenv',
    ]));
    const writes = command.args.flatMap((arg, i) => arg === '--bind' ? [command.args.slice(i + 1, i + 3)] : []);
    expect(writes).toEqual([[input.credentialRoot, '/credentials'], [input.requestRoot, input.requestRoot]]);
    expect(command.args).not.toContain('--ro-bind-try');
    expect(command.args).not.toContain('--unshare-user-try');
    expect(command.args).not.toContain('/app');
    expect(command.args).not.toContain('/home');
    expect(command.args.slice(-4)).toEqual(['--', '/grok', '--tools', 'image_to_video']);
  });
  it.each(['win32', 'darwin'])('fails closed on unsupported %s', platform => {
    osPlatform.mockReturnValue(platform);
    expect(() => grokSandboxCommand(input)).toThrow('Linux CLI isolation runtime');
  });
  it('fails closed when bubblewrap is missing', () => {
    exists.mockReturnValue(false);
    expect(() => grokSandboxCommand(input)).toThrow('Linux CLI isolation runtime');
  });
  it('rejects a symlinked mount source', () => {
    canonical.mockReturnValue(resolve('/fixture/other-user'));
    expect(() => grokSandboxCommand(input)).toThrow('Unsafe Grok isolation path');
  });
  it('binds a sealing launcher inside the sandbox with an exact transfer length', () => {
    canonical.mockImplementation(path => resolve(path));
    const launcher = resolve('/fixture/launcher');
    const command = grokSandboxCommand({ ...input, imageLauncher: { executable: launcher, byteLength: 128 } });
    expect(command.args).toContain(launcher);
    expect(command.args.slice(-6)).toEqual(['--', '/grok-input-launch', '128', '--', '--tools', 'image_to_video']);
    expect(command.env).toEqual({});
  });
  it.each([0, 11, 20 * 1024 * 1024 + 1, 12.5, NaN])('rejects invalid binary transfer length %s', byteLength => {
    expect(() => grokSandboxCommand({ ...input, imageLauncher: { executable: input.executable, byteLength } }))
      .toThrow('Invalid isolated image transfer length');
  });
});
