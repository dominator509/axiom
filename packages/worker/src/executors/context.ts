// ─── Executor contract ───
// Each executor runs inside the claim transaction (org RLS context already
// set by claim_job). It performs the domain work; throwing aborts and the
// worker applies retry/backoff/dead. Once an executor marks provider I/O as
// started, a later failure is dead-lettered instead of retried because the
// external outcome is unknown. Executors that must gate on the global kill
// switch check org_settings.publishing_enabled inside their txn (L3.4 §5).

import type { JobRow } from '../types.js';

export interface ExecutorContext {
  tx: any;
  job: JobRow;
  workerId: string;
  /** Resolved kill-switch state for the org (checked inside txn). */
  killSwitchEnabled: boolean;
  /**
   * Set immediately before an external side effect. If the executor later
   * fails, the worker must dead-letter the job rather than retrying an
   * outcome that the provider may already have accepted.
   */
  markExternalSideEffect?: () => void;
}

export type Executor = (ctx: ExecutorContext) => Promise<void>;

/** Signals the worker to park the job back to ready with a delay (kill switch / rate bucket). */
export class ParkJobError extends Error {
  constructor(
    message: string,
    public readonly delayMs: number,
  ) {
    super(message);
    this.name = 'ParkJobError';
  }
}

/** Durable incident prefix used to keep unknown provider outcomes fail-closed. */
export const EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX = 'external-side-effect-unknown:';

export function isExternalSideEffectUnknown(lastError: string | null | undefined): boolean {
  return lastError?.startsWith(EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX) ?? false;
}
