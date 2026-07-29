import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId: string;
  source?: string;
  data?: Record<string, unknown>;
  error?: { message: string; stack?: string };
}

const asyncStore = new AsyncLocalStorage<string>();

export function getCorrelationId(): string {
  return asyncStore.getStore() ?? 'no-correlation-id';
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return asyncStore.run(correlationId, fn);
}

export class Logger {
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>, err?: Error): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: getCorrelationId(),
      source: this.source,
      ...(data ? { data } : {}),
      ...(err ? { error: { message: err.message, stack: err.stack } } : {}),
    };
    const output = JSON.stringify(entry);
    switch (level) {
      case 'fatal':
      case 'error':
        process.stderr.write(output + '\n');
        break;
      default:
        process.stdout.write(output + '\n');
    }
  }

  debug(message: string, data?: Record<string, unknown>): void { this.log('debug', message, data); }
  info(message: string, data?: Record<string, unknown>): void { this.log('info', message, data); }
  warn(message: string, data?: Record<string, unknown>): void { this.log('warn', message, data); }
  error(message: string, err?: Error, data?: Record<string, unknown>): void { this.log('error', message, data, err); }
  fatal(message: string, err?: Error, data?: Record<string, unknown>): void { this.log('fatal', message, data, err); }

  child(source: string): Logger {
    return new Logger(`${this.source}:${source}`);
  }
}
