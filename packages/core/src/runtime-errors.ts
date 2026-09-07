// ─── Process-level runtime failure handling ─────────────────────────────────
// Request-scoped errors are captured by the API crash sink. These handlers
// cover failures outside a request/job boundary and fail fast so a supervisor
// can restart the process instead of leaving it in an unknown state.

export type RuntimeFailureEvent = 'uncaughtException' | 'unhandledRejection';

export interface RuntimeErrorDetails {
  name: string;
  message: string;
  stack: string;
}

export interface RuntimeFailureLog {
  timestamp: string;
  level: 'fatal';
  event: RuntimeFailureEvent;
  service: string;
  error: RuntimeErrorDetails;
}

export interface RuntimeProcessHooks {
  once(event: RuntimeFailureEvent, handler: (reason: unknown) => void): unknown;
  exit(code: number): never;
}

export interface InstallRuntimeFailureHandlersOptions {
  service: string;
  process: RuntimeProcessHooks;
  write: (entry: RuntimeFailureLog) => void;
}

/** Keep credentials out of process-level logs. */
export function redactRuntimeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    );
}

/** Convert any thrown/rejected value into a bounded, secret-scrubbed record. */
export function describeRuntimeError(error: unknown): RuntimeErrorDetails {
  const source = error instanceof Error ? error : new Error(String(error));
  const message = redactRuntimeText(`${source.name}: ${source.message}`).slice(0, 2000);
  const stack = redactRuntimeText(source.stack ?? message)
    .split('\n')
    .slice(0, 50)
    .map((line) => line.slice(0, 2000))
    .join('\n');
  return { name: source.name.slice(0, 200), message, stack };
}

/**
 * Register fail-fast handlers for errors that escape request/job boundaries.
 * The logger is injected so this package remains runtime-neutral and easy to
 * exercise without installing process listeners in tests.
 */
export function installRuntimeFailureHandlers(options: InstallRuntimeFailureHandlersOptions): void {
  let exiting = false;
  const handle = (event: RuntimeFailureEvent, reason: unknown): void => {
    if (exiting) return;
    exiting = true;
    options.write({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      event,
      service: options.service,
      error: describeRuntimeError(reason),
    });
    options.process.exit(1);
  };

  options.process.once('uncaughtException', (reason) => handle('uncaughtException', reason));
  options.process.once('unhandledRejection', (reason) => handle('unhandledRejection', reason));
}
