// ─── Logger / correlation id — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, getCorrelationId, runWithCorrelationId, type LogEntry } from './logging.js';

let stdoutSpy: any;
let stderrSpy: any;

function lastStdoutEntry(): LogEntry {
  const calls = stdoutSpy.mock.calls as unknown as Array<[string]>;
  return JSON.parse(calls[calls.length - 1][0]);
}

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write');
  stderrSpy = vi.spyOn(process.stderr, 'write');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('correlation ids', () => {
  it('returns no-correlation-id outside a context', () => {
    expect(getCorrelationId()).toBe('no-correlation-id');
  });

  it('returns the correlation id inside runWithCorrelationId', () => {
    const result = runWithCorrelationId('corr-123', () => getCorrelationId());
    expect(result).toBe('corr-123');
  });

  it('propagates the id through async boundaries', async () => {
    const id = await runWithCorrelationId('corr-456', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getCorrelationId();
    });
    expect(id).toBe('corr-456');
  });

  it('restores the outer context after nested runs', () => {
    const outer = runWithCorrelationId('outer', () => {
      runWithCorrelationId('inner', () => getCorrelationId());
      return getCorrelationId();
    });
    expect(outer).toBe('outer');
  });
});

describe('Logger', () => {
  it('writes structured JSON debug/info/warn entries to stdout', () => {
    const logger = new Logger('relay');
    logger.info('hello world', { count: 3 });
    const entry = lastStdoutEntry();
    expect(entry).toMatchObject({
      level: 'info',
      message: 'hello world',
      source: 'relay',
      correlationId: 'no-correlation-id',
      data: { count: 3 },
    });
    expect(typeof entry.timestamp).toBe('string');
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
  });

  it('writes debug and warn levels to stdout', () => {
    const logger = new Logger('relay');
    logger.debug('dbg');
    logger.warn('wrn');
    const levels = stdoutSpy.mock.calls.map((c: [string]) => (JSON.parse(c[0] as string) as LogEntry).level);
    expect(levels).toEqual(['debug', 'warn']);
  });

  it('writes error and fatal entries to stderr with error details', () => {
    const logger = new Logger('relay');
    const err = new Error('boom');
    logger.error('failed', err, { id: 'x' });
    logger.fatal('dead', err);
    // First stderr entry is the error; last is the fatal
    const errEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string) as LogEntry;
    expect(errEntry).toMatchObject({
      level: 'error',
      message: 'failed',
      source: 'relay',
      data: { id: 'x' },
      error: { message: 'boom' },
    });
    expect(errEntry.error?.stack).toContain('Error: boom');
    const fatalEntry = JSON.parse(stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0] as string);
    expect(fatalEntry.level).toBe('fatal');
    expect(fatalEntry.error?.message).toBe('boom');
  });

  it('includes the active correlation id in emitted entries', () => {
    const logger = new Logger('relay');
    runWithCorrelationId('corr-999', () => {
      logger.info('tracked');
    });
    expect(lastStdoutEntry().correlationId).toBe('corr-999');
  });

  it('child() prefixes the source', () => {
    const logger = new Logger('relay');
    logger.child('commands').info('child message');
    expect(lastStdoutEntry().source).toBe('relay:commands');
  });

  it('omits data and error keys when not provided', () => {
    const logger = new Logger('relay');
    logger.info('bare');
    const entry = lastStdoutEntry();
    expect(entry.data).toBeUndefined();
    expect(entry.error).toBeUndefined();
  });
});
