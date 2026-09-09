import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { OfficialSubscriptionTransport } from './subscription.js';

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    child.emit('exit', null);
    return true;
  });
  return child;
}

describe('official subscription auth command lifecycle', () => {
  let subscriptionHome: string;
  let transport: OfficialSubscriptionTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    subscriptionHome = join(tmpdir(), `axiom-subscription-${randomUUID()}`);
    vi.stubEnv('AXIOM_SUBSCRIPTION_HOME', subscriptionHome);
    vi.stubEnv('AXIOM_LLM_TRANSPORT_TIMEOUT_MS', '25');
    transport = new OfficialSubscriptionTransport();
  });

  afterEach(() => {
    spawnMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(subscriptionHome, { recursive: true, force: true });
  });

  it.each(['status', 'disconnect'] as const)(
    'times out a hanging %s command and terminates its child process',
    async (operation) => {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);

      const pending =
        operation === 'status'
          ? transport.status('openai', 'user-1')
          : transport.disconnect('openai', 'user-1');
      const rejection = expect(pending).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(child.kill).toHaveBeenCalledTimes(1);
    },
  );

  it('aborts a status command when the request is cancelled', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();

    const pending = transport.status('openai', 'user-1', controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();

    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('passes only runtime environment to provider subprocesses', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    vi.stubEnv('PATH', 'trusted-path');
    vi.stubEnv('DATABASE_URL', 'postgresql://should-not-cross-the-boundary');
    vi.stubEnv('AXIOM_INTERNAL_SECRET', 'should-not-cross-the-boundary');
    vi.stubEnv('OPENAI_API_KEY', 'should-not-cross-the-boundary');

    const pending = transport.status('openai', 'user-1');
    const options = spawnMock.mock.calls.at(-1)?.[2] as { env?: NodeJS.ProcessEnv };
    expect(options.env?.PATH).toBe('trusted-path');
    expect(options.env).not.toHaveProperty('DATABASE_URL');
    expect(options.env).not.toHaveProperty('AXIOM_INTERNAL_SECRET');
    expect(options.env).not.toHaveProperty('OPENAI_API_KEY');

    child.emit('exit', 0);
    await expect(pending).resolves.toMatchObject({ provider: 'openai', connected: true });
  });
});
