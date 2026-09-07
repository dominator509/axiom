import { describe, expect, it } from 'vitest';
import {
  describeRuntimeError,
  installRuntimeFailureHandlers,
  redactRuntimeText,
  type RuntimeFailureEvent,
} from './runtime-errors.js';

describe('runtime failure handling', () => {
  it('redacts credentials from process-level error text', () => {
    expect(
      redactRuntimeText('Bearer abc authorization:xyz access_token=secret refresh-token=next'),
    ).toBe(
      'Bearer [REDACTED] authorization:[REDACTED] access_token=[REDACTED] refresh-token=[REDACTED]',
    );
  });

  it('bounds and scrubs unknown runtime errors', () => {
    const details = describeRuntimeError(
      new Error(`authorization=top-secret\n${'frame '.repeat(1000)}`),
    );
    expect(details.message).toContain('authorization=[REDACTED]');
    expect(details.stack.length).toBeLessThanOrEqual(100_000);
    expect(details.stack).not.toContain('top-secret');
  });

  it('logs each fatal event once and exits fail-closed', () => {
    const handlers = new Map<RuntimeFailureEvent, (reason: unknown) => void>();
    const entries: unknown[] = [];
    const exits: number[] = [];
    const fakeProcess = {
      once(event: RuntimeFailureEvent, handler: (reason: unknown) => void) {
        handlers.set(event, handler);
      },
      exit(code: number): never {
        exits.push(code);
        throw new Error(`exit:${code}`);
      },
    };

    installRuntimeFailureHandlers({
      service: 'worker',
      process: fakeProcess,
      write: (entry) => entries.push(entry),
    });

    expect(() => handlers.get('unhandledRejection')?.('Bearer leaked')).toThrow('exit:1');
    expect(() => handlers.get('uncaughtException')?.(new Error('second failure'))).not.toThrow();
    expect(exits).toEqual([1]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'fatal',
      event: 'unhandledRejection',
      service: 'worker',
      error: { message: 'Error: Bearer [REDACTED]' },
    });
  });
});
