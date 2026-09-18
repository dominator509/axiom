// ─── Scraper orchestration & result-quality contract ──────────────────────
//
// Closes source-level result-quality gaps WITHOUT bypassing model egress or
// direct-fallback protections. Pure contract: no sidecar launch, no provider
// call, no VPN, no browser. Deployed sidecar/VPN/provider acceptance remains
// unclaimed.

export type ScrapeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';

/** Durable scrape-run state owned by exactly one org/model scope. */
export interface ScrapeRun {
  runId: string;
  orgId: string;
  modelId: string;
  /** The egress binding the run must use. Never optional at dispatch time. */
  egressBindingId: string;
  status: ScrapeRunStatus;
  createdAt: string;
  updatedAt: string;
}

/** Bounded request validation for a scrape request. */
export const SCRAPE_LIMITS = {
  maxTargets: 25,
  maxQueryLength: 500,
  maxTimeoutMs: 120_000,
  minTimeoutMs: 1_000,
  maxConcurrency: 5,
} as const;

export interface ScrapeRequest {
  orgId: string;
  modelId: string;
  query: string;
  targets: string[];
  timeoutMs?: number;
  concurrency?: number;
  egressBindingId?: string;
}

export interface ScrapeValidation {
  ok: boolean;
  errors: string[];
}

export function validateScrapeRequest(request: Partial<ScrapeRequest>): ScrapeValidation {
  const errors: string[] = [];
  if (!request.orgId) errors.push('orgId is required');
  if (!request.modelId) errors.push('modelId is required');
  if (typeof request.query !== 'string' || request.query.trim().length === 0) {
    errors.push('query is required');
  } else if (request.query.length > SCRAPE_LIMITS.maxQueryLength) {
    errors.push(`query exceeds ${SCRAPE_LIMITS.maxQueryLength} characters`);
  }
  if (!Array.isArray(request.targets) || request.targets.length === 0) {
    errors.push('at least one target is required');
  } else if (request.targets.length > SCRAPE_LIMITS.maxTargets) {
    errors.push(`at most ${SCRAPE_LIMITS.maxTargets} targets are allowed`);
  } else if (request.targets.some((t) => typeof t !== 'string' || t.trim().length === 0)) {
    errors.push('targets must be non-empty strings');
  }
  if (request.timeoutMs !== undefined) {
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < SCRAPE_LIMITS.minTimeoutMs || request.timeoutMs > SCRAPE_LIMITS.maxTimeoutMs) {
      errors.push(`timeoutMs must be an integer between ${SCRAPE_LIMITS.minTimeoutMs} and ${SCRAPE_LIMITS.maxTimeoutMs}`);
    }
  }
  if (request.concurrency !== undefined) {
    if (!Number.isInteger(request.concurrency) || request.concurrency < 1 || request.concurrency > SCRAPE_LIMITS.maxConcurrency) {
      errors.push(`concurrency must be an integer between 1 and ${SCRAPE_LIMITS.maxConcurrency}`);
    }
  }
  if (!request.egressBindingId) {
    errors.push('egressBindingId is required');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Dispatch guard. A run may only be dispatched when it is queued, scoped, and
 * has a live egress binding. The egress kill-switch always wins: when engaged,
 * no dispatch is permitted and direct fallback is never substituted.
 */
export interface DispatchDecision {
  dispatch: boolean;
  reason: 'ok' | 'not_queued' | 'scope_mismatch' | 'missing_egress_binding' | 'egress_kill_switch_engaged' | 'direct_fallback_forbidden';
}

export function canDispatchScrapeRun(
  run: ScrapeRun,
  ctx: { orgId: string; modelId: string; egressBindingId?: string; egressKillSwitch: boolean; directFallbackRequested?: boolean },
): DispatchDecision {
  if (run.status !== 'queued') return { dispatch: false, reason: 'not_queued' };
  if (run.orgId !== ctx.orgId || run.modelId !== ctx.modelId) return { dispatch: false, reason: 'scope_mismatch' };
  if (ctx.directFallbackRequested) return { dispatch: false, reason: 'direct_fallback_forbidden' };
  if (ctx.egressKillSwitch) return { dispatch: false, reason: 'egress_kill_switch_engaged' };
  if (!ctx.egressBindingId || ctx.egressBindingId !== run.egressBindingId) {
    return { dispatch: false, reason: 'missing_egress_binding' };
  }
  return { dispatch: true, reason: 'ok' };
}

/** A structured scrape result per target. Partial failure is explicit. */
export interface ScrapeTargetResult {
  target: string;
  ok: boolean;
  /** Items actually retrieved. */
  items: string[];
  /** Count the source reported as unavailable or missing, when known. */
  missingCount?: number;
  error?: string;
}

export interface ScrapeOutcome {
  status: ScrapeRunStatus;
  results: ScrapeTargetResult[];
  totalItems: number;
  missingCount: number;
  failedTargets: number;
  /** Never present an empty or all-failed run as success. */
  presentedAsSuccess: boolean;
}

/**
 * Aggregate target results truthfully:
 *  - all targets failed -> 'failed' (never success);
 *  - some failed -> 'partial';
 *  - all ok but zero items -> 'partial' (an empty result is not a success);
 *  - all ok with items -> 'completed'.
 * Missing counts are reported when known and never invented as zero.
 */
export function aggregateScrapeOutcome(results: ScrapeTargetResult[]): ScrapeOutcome {
  const failedTargets = results.filter((r) => !r.ok).length;
  const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);
  const missingCount = results.reduce((sum, r) => sum + (r.missingCount ?? 0), 0);

  let status: ScrapeRunStatus;
  if (results.length === 0 || failedTargets === results.length) {
    status = 'failed';
  } else if (failedTargets > 0) {
    status = 'partial';
  } else if (totalItems === 0) {
    status = 'partial';
  } else {
    status = 'completed';
  }

  return {
    status,
    results,
    totalItems,
    missingCount,
    failedTargets,
    presentedAsSuccess: status === 'completed',
  };
}

/** An all-failed run is rejected: it must not be persisted or shown as success. */
export function rejectAllFailedOutcome(outcome: ScrapeOutcome): boolean {
  return outcome.status !== 'failed';
}

/** Deduplicate results across targets, preserving first-seen order. */
export function dedupeResults(results: ScrapeTargetResult[]): ScrapeTargetResult[] {
  const seen = new Set<string>();
  return results.map((result) => {
    const unique: string[] = [];
    for (const entry of result.items) {
      const key = entry.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(entry);
    }
    return { ...result, items: unique };
  });
}

/** Bound concurrency and timeout before dispatch. */
export function effectiveConcurrency(requested?: number): number {
  if (requested === undefined) return 1;
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.min(requested, SCRAPE_LIMITS.maxConcurrency);
}

export function effectiveTimeout(requested?: number): number {
  const fallback = 30_000;
  if (requested === undefined) return fallback;
  if (!Number.isInteger(requested)) return fallback;
  return Math.max(SCRAPE_LIMITS.minTimeoutMs, Math.min(requested, SCRAPE_LIMITS.maxTimeoutMs));
}

/** Benchmark/history evidence rows for the quality surface. */
export interface ScrapeHistoryEntry {
  runId: string;
  status: ScrapeRunStatus;
  totalItems: number;
  missingCount: number;
  failedTargets: number;
  durationMs: number;
  recordedAt: string;
}

export interface ScrapeBenchmark {
  runs: number;
  completedRuns: number;
  successRate: number;
  averageItems: number;
  averageDurationMs: number;
}

/** Compute quality evidence over a bounded history window. */
export function computeScrapeBenchmark(entries: ScrapeHistoryEntry[]): ScrapeBenchmark {
  if (entries.length === 0) {
    return { runs: 0, completedRuns: 0, successRate: 0, averageItems: 0, averageDurationMs: 0 };
  }
  const completed = entries.filter((e) => e.status === 'completed');
  const totalItems = entries.reduce((sum, e) => sum + e.totalItems, 0);
  const totalDuration = entries.reduce((sum, e) => sum + e.durationMs, 0);
  return {
    runs: entries.length,
    completedRuns: completed.length,
    successRate: completed.length / entries.length,
    averageItems: totalItems / entries.length,
    averageDurationMs: totalDuration / entries.length,
  };
}

/** Bounded history pagination with an opaque cursor. */
export function paginateScrapeHistory(
  entries: ScrapeHistoryEntry[],
  pageSize = 20,
  cursor?: string,
): { data: ScrapeHistoryEntry[]; nextCursor: string | null } {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page size');
  let start = 0;
  if (cursor) {
    const index = entries.findIndex((e) => e.runId === cursor);
    if (index === -1) throw new Error('invalid history cursor');
    start = index + 1;
  }
  const slice = entries.slice(start, start + pageSize + 1);
  const hasMore = slice.length > pageSize;
  const data = slice.slice(0, pageSize);
  return { data, nextCursor: hasMore ? data[data.length - 1].runId : null };
}

/** Truthful UI refresh state: an empty or all-failed run is not a success banner. */
export interface ScrapePresentation {
  state: 'loading' | 'empty' | 'failed' | 'partial' | 'ready';
  message: string;
}

export function scrapePresentation(outcome: ScrapeOutcome | undefined, loading = false): ScrapePresentation {
  if (loading) return { state: 'loading', message: 'Scraping…' };
  if (!outcome) return { state: 'empty', message: 'No run selected.' };
  if (outcome.status === 'failed') return { state: 'failed', message: 'The scrape failed. No results were collected.' };
  if (outcome.status === 'partial') return { state: 'partial', message: `Partial results: ${outcome.failedTargets} target(s) failed.` };
  if (outcome.totalItems === 0) return { state: 'empty', message: 'No results were found.' };
  return { state: 'ready', message: '' };
}
