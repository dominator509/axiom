// ─── Scraper orchestration & result-quality tests ─────────────────────────
//
// Pure tests: no sidecar, no VPN, no provider, no browser, no deployment.

import { describe, expect, it } from 'vitest';
import {
  SCRAPE_LIMITS,
  aggregateScrapeOutcome,
  canDispatchScrapeRun,
  computeScrapeBenchmark,
  dedupeResults,
  effectiveConcurrency,
  effectiveTimeout,
  paginateScrapeHistory,
  rejectAllFailedOutcome,
  scrapePresentation,
  validateScrapeRequest,
  type ScrapeHistoryEntry,
  type ScrapeRun,
  type ScrapeTargetResult,
} from './scraper-quality-contract.js';

function run(overrides: Partial<ScrapeRun> = {}): ScrapeRun {
  return {
    runId: 'run-1',
    orgId: 'org-1',
    modelId: 'model-1',
    egressBindingId: 'egress-1',
    status: 'queued',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

const okCtx = { orgId: 'org-1', modelId: 'model-1', egressBindingId: 'egress-1', egressKillSwitch: false };

describe('scraper request validation', () => {
  it('accepts a well-formed bounded request', () => {
    expect(validateScrapeRequest({
      orgId: 'org-1', modelId: 'model-1', query: 'trending', targets: ['a'], egressBindingId: 'egress-1',
    })).toEqual({ ok: true, errors: [] });
  });

  it('rejects a missing scope, query, targets or egress binding', () => {
    const result = validateScrapeRequest({ targets: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/orgId/);
    expect(result.errors.join(' ')).toMatch(/modelId/);
    expect(result.errors.join(' ')).toMatch(/query/);
    expect(result.errors.join(' ')).toMatch(/target/);
    expect(result.errors.join(' ')).toMatch(/egressBindingId/);
  });

  it('bounds query length, target count and target shape', () => {
    expect(validateScrapeRequest({
      orgId: 'o', modelId: 'm', egressBindingId: 'e',
      query: 'x'.repeat(SCRAPE_LIMITS.maxQueryLength + 1),
      targets: ['a'],
    }).errors.join(' ')).toMatch(/exceeds/);

    expect(validateScrapeRequest({
      orgId: 'o', modelId: 'm', egressBindingId: 'e', query: 'q',
      targets: Array.from({ length: SCRAPE_LIMITS.maxTargets + 1 }, (_, i) => `t${i}`),
    }).errors.join(' ')).toMatch(/at most/);

    expect(validateScrapeRequest({ orgId: 'o', modelId: 'm', egressBindingId: 'e', query: 'q', targets: [''] }).ok).toBe(false);
  });

  it('bounds timeout and concurrency', () => {
    expect(validateScrapeRequest({ orgId: 'o', modelId: 'm', egressBindingId: 'e', query: 'q', targets: ['a'], timeoutMs: 500 }).ok).toBe(false);
    expect(validateScrapeRequest({ orgId: 'o', modelId: 'm', egressBindingId: 'e', query: 'q', targets: ['a'], timeoutMs: 999_999 }).ok).toBe(false);
    expect(validateScrapeRequest({ orgId: 'o', modelId: 'm', egressBindingId: 'e', query: 'q', targets: ['a'], concurrency: 99 }).ok).toBe(false);
    expect(validateScrapeRequest({ orgId: 'o', modelId: 'm', egressBindingId: 'e', query: 'q', targets: ['a'], concurrency: 3 }).ok).toBe(true);
  });
});

describe('scraper dispatch ownership and egress binding', () => {
  it('dispatches a queued, correctly-scoped run with a live binding', () => {
    expect(canDispatchScrapeRun(run(), okCtx)).toEqual({ dispatch: true, reason: 'ok' });
  });

  it('refuses a run that is not queued', () => {
    for (const status of ['running', 'completed', 'failed', 'partial'] as const) {
      expect(canDispatchScrapeRun(run({ status }), okCtx).reason).toBe('not_queued');
    }
  });

  it('refuses a cross-tenant or cross-model run', () => {
    expect(canDispatchScrapeRun(run({ orgId: 'other' }), okCtx).reason).toBe('scope_mismatch');
    expect(canDispatchScrapeRun(run({ modelId: 'other' }), okCtx).reason).toBe('scope_mismatch');
  });

  it('refuses dispatch without a matching egress binding', () => {
    expect(canDispatchScrapeRun(run(), { ...okCtx, egressBindingId: undefined }).reason).toBe('missing_egress_binding');
    expect(canDispatchScrapeRun(run(), { ...okCtx, egressBindingId: 'other' }).reason).toBe('missing_egress_binding');
  });

  it('honors the egress kill-switch above everything else', () => {
    expect(canDispatchScrapeRun(run(), { ...okCtx, egressKillSwitch: true }).reason).toBe('egress_kill_switch_engaged');
  });

  it('never substitutes a direct fallback when egress is engaged or unavailable', () => {
    expect(canDispatchScrapeRun(run(), { ...okCtx, directFallbackRequested: true }).reason).toBe('direct_fallback_forbidden');
    expect(canDispatchScrapeRun(run(), { ...okCtx, egressKillSwitch: true, directFallbackRequested: true }).reason).toBe('direct_fallback_forbidden');
  });
});

describe('scraper partial, missing and all-failed semantics', () => {
  const good: ScrapeTargetResult = { target: 'a', ok: true, items: ['x', 'y'] };
  const bad: ScrapeTargetResult = { target: 'b', ok: false, items: [], error: 'timeout' };

  it('completes only when every target succeeds with results', () => {
    const outcome = aggregateScrapeOutcome([good]);
    expect(outcome.status).toBe('completed');
    expect(outcome.presentedAsSuccess).toBe(true);
  });

  it('reports partial when some targets fail', () => {
    const outcome = aggregateScrapeOutcome([good, bad]);
    expect(outcome.status).toBe('partial');
    expect(outcome.failedTargets).toBe(1);
    expect(outcome.presentedAsSuccess).toBe(false);
  });

  it('never presents an all-failed run as success', () => {
    const outcome = aggregateScrapeOutcome([bad, { target: 'c', ok: false, items: [] }]);
    expect(outcome.status).toBe('failed');
    expect(outcome.presentedAsSuccess).toBe(false);
    expect(rejectAllFailedOutcome(outcome)).toBe(false);
  });

  it('treats an all-ok but empty run as partial, not success', () => {
    const outcome = aggregateScrapeOutcome([{ target: 'a', ok: true, items: [] }]);
    expect(outcome.status).toBe('partial');
    expect(outcome.totalItems).toBe(0);
    expect(outcome.presentedAsSuccess).toBe(false);
  });

  it('reports missing counts when known and does not invent them', () => {
    const outcome = aggregateScrapeOutcome([
      { target: 'a', ok: true, items: ['x'], missingCount: 3 },
      { target: 'b', ok: true, items: ['y'] },
    ]);
    expect(outcome.missingCount).toBe(3);
  });

  it('treats an empty target list as failed, not success', () => {
    expect(aggregateScrapeOutcome([]).status).toBe('failed');
  });
});

describe('scraper deduplication', () => {
  it('deduplicates across targets, preserving first-seen order and case-insensitivity', () => {
    const deduped = dedupeResults([
      { target: 'a', ok: true, items: ['One', 'two'] },
      { target: 'b', ok: true, items: ['one', 'THREE'] },
    ]);
    expect(deduped[0].items).toEqual(['One', 'two']);
    expect(deduped[1].items).toEqual(['THREE']);
  });

  it('preserves per-target failure state during dedupe', () => {
    const deduped = dedupeResults([{ target: 'a', ok: false, items: [], error: 'x' }]);
    expect(deduped[0].ok).toBe(false);
    expect(deduped[0].error).toBe('x');
  });
});

describe('scraper concurrency and timeout bounds', () => {
  it('clamps concurrency to the documented maximum and floor of one', () => {
    expect(effectiveConcurrency(undefined)).toBe(1);
    expect(effectiveConcurrency(0)).toBe(1);
    expect(effectiveConcurrency(3)).toBe(3);
    expect(effectiveConcurrency(999)).toBe(SCRAPE_LIMITS.maxConcurrency);
  });

  it('clamps timeout inside the documented window', () => {
    expect(effectiveTimeout(undefined)).toBe(30_000);
    expect(effectiveTimeout(10)).toBe(SCRAPE_LIMITS.minTimeoutMs);
    expect(effectiveTimeout(999_999)).toBe(SCRAPE_LIMITS.maxTimeoutMs);
    expect(effectiveTimeout(5_000)).toBe(5_000);
  });
});

describe('scraper benchmark/history quality evidence', () => {
  const entries: ScrapeHistoryEntry[] = [
    { runId: 'r1', status: 'completed', totalItems: 10, missingCount: 0, failedTargets: 0, durationMs: 1_000, recordedAt: '2026-04-01T00:00:00Z' },
    { runId: 'r2', status: 'partial', totalItems: 4, missingCount: 2, failedTargets: 1, durationMs: 3_000, recordedAt: '2026-04-02T00:00:00Z' },
    { runId: 'r3', status: 'failed', totalItems: 0, missingCount: 0, failedTargets: 2, durationMs: 2_000, recordedAt: '2026-04-03T00:00:00Z' },
  ];

  it('computes a truthful success rate over the window', () => {
    const benchmark = computeScrapeBenchmark(entries);
    expect(benchmark.runs).toBe(3);
    expect(benchmark.completedRuns).toBe(1);
    expect(benchmark.successRate).toBeCloseTo(1 / 3);
    expect(benchmark.averageItems).toBeCloseTo(14 / 3);
    expect(benchmark.averageDurationMs).toBeCloseTo(2_000);
  });

  it('returns zeroed evidence for an empty window', () => {
    expect(computeScrapeBenchmark([])).toEqual({ runs: 0, completedRuns: 0, successRate: 0, averageItems: 0, averageDurationMs: 0 });
  });

  it('paginates history with an opaque cursor', () => {
    const page1 = paginateScrapeHistory(entries, 2);
    expect(page1.data.map((e) => e.runId)).toEqual(['r1', 'r2']);
    expect(page1.nextCursor).toBe('r2');
    const page2 = paginateScrapeHistory(entries, 2, page1.nextCursor!);
    expect(page2.data.map((e) => e.runId)).toEqual(['r3']);
    expect(page2.nextCursor).toBeNull();
  });

  it('rejects an invalid page size and cursor', () => {
    expect(() => paginateScrapeHistory(entries, 0)).toThrow(/invalid page size/);
    expect(() => paginateScrapeHistory(entries, 20, 'missing')).toThrow(/invalid history cursor/);
  });
});

describe('scraper responsive states', () => {
  it('never shows an empty or all-failed run as a success banner', () => {
    const failed = aggregateScrapeOutcome([{ target: 'a', ok: false, items: [] }]);
    expect(scrapePresentation(failed).state).toBe('failed');

    const empty = aggregateScrapeOutcome([{ target: 'a', ok: true, items: [] }]);
    expect(scrapePresentation(empty).state).not.toBe('ready');

    const partial = aggregateScrapeOutcome([{ target: 'a', ok: true, items: ['x'] }, { target: 'b', ok: false, items: [] }]);
    expect(scrapePresentation(partial).state).toBe('partial');
  });

  it('distinguishes loading and no-run-selected', () => {
    expect(scrapePresentation(undefined, true).state).toBe('loading');
    expect(scrapePresentation(undefined, false).state).toBe('empty');
  });

  it('reports ready only for a genuinely completed run', () => {
    const completed = aggregateScrapeOutcome([{ target: 'a', ok: true, items: ['x'] }]);
    expect(scrapePresentation(completed).state).toBe('ready');
  });
});
