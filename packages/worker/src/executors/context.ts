// ─── Executor contract ───
// Each executor runs inside the claim transaction (org RLS context already
// set by claim_job). It performs the domain work; throwing aborts and the
// worker applies retry/backoff/dead. Executors that must gate on the global
// kill switch check org_settings.publishing_enabled inside their txn (L3.4 §5).

import type { JobRow } from '../types.js';

export interface ExecutorContext {
  tx: any;
  job: JobRow;
  workerId: string;
  /** Resolved kill-switch state for the org (checked inside txn). */
  killSwitchEnabled: boolean;
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
