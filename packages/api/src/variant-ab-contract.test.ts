// ─── Variant / A-B experiment contract tests ──────────────────────────────
//
// Pure tests: no publication, no provider, no runtime, no deployment.

import { describe, expect, it } from 'vitest';
import {
  GUIDANCE_LIMITS,
  accountExposures,
  attributeGuidance,
  averageMetric,
  canAttachReviewBundle,
  canTransitionExperiment,
  claimAssignment,
  experimentPublishesDirectly,
  isExperimentVisible,
  paginateExperiments,
  promoteWinner,
  selectWinner,
  timingBucketForHour,
  validateExperimentTransition,
  validateGuidanceEvidence,
  type Assignment,
  type CandidateGuard,
  type Experiment,
  type GuidanceEvidence,
} from './variant-ab-contract.js';

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    experimentId: 'exp-1',
    orgId: 'org-1',
    modelId: 'model-1',
    name: 'Hook test',
    platform: 'instagram',
    status: 'draft',
    evaluationPolicy: 'fixed-post-engagement-v1',
    variantIds: ['var-1', 'var-2'],
    createdAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

const ctx = { orgId: 'org-1', modelId: 'model-1', platform: 'instagram', capabilityAllows: true };
const candidates: CandidateGuard[] = [
  { variantId: 'var-1', ownedByModel: true, consentPresent: true },
  { variantId: 'var-2', ownedByModel: true, consentPresent: true },
];

describe('variant experiment lifecycle transitions', () => {
  it('allows the documented transitions and closes completed', () => {
    expect(canTransitionExperiment('draft', 'running')).toBe(true);
    expect(canTransitionExperiment('running', 'paused')).toBe(true);
    expect(canTransitionExperiment('paused', 'running')).toBe(true);
    expect(canTransitionExperiment('running', 'completed')).toBe(true);
    expect(canTransitionExperiment('completed', 'running')).toBe(false);
    expect(canTransitionExperiment('draft', 'paused')).toBe(false);
  });

  it('requires scope, capability, owned candidates and consent to run', () => {
    expect(validateExperimentTransition(experiment(), 'running', ctx, candidates)).toEqual({ ok: true });
    expect(validateExperimentTransition(experiment(), 'running', { ...ctx, orgId: 'other' }, candidates).reason).toBe('scope_mismatch');
    expect(validateExperimentTransition(experiment(), 'running', { ...ctx, capabilityAllows: false }, candidates).reason).toBe('platform_unsupported');
    expect(validateExperimentTransition(
      experiment(),
      'running',
      ctx,
      [{ variantId: 'var-1', ownedByModel: false, consentPresent: true }],
    ).reason).toBe('candidate_not_owned');
    expect(validateExperimentTransition(
      experiment(),
      'running',
      ctx,
      [{ variantId: 'var-1', ownedByModel: true, consentPresent: false }],
    ).reason).toBe('consent_missing');
  });

  it('refuses to run an experiment with no candidates', () => {
    expect(validateExperimentTransition(experiment({ variantIds: [] }), 'running', ctx, []).reason).toBe('no_candidates');
  });

  it('never lets an experiment control publish directly', () => {
    expect(experimentPublishesDirectly()).toBe(false);
  });
});

describe('variant candidate assignment idempotency', () => {
  it('claims an assignment key exactly once per experiment', () => {
    const seen = new Set<string>();
    expect(claimAssignment(seen, 'exp-1', 'key-1')).toBe(true);
    expect(claimAssignment(seen, 'exp-1', 'key-1')).toBe(false);
    // The same key in a different experiment is a distinct assignment.
    expect(claimAssignment(seen, 'exp-2', 'key-1')).toBe(true);
    expect(claimAssignment(seen, 'exp-1', '')).toBe(false);
  });

  it('allows a review bundle on only one assignment', () => {
    const map = new Map<string, string>([['rb-1', 'a-1']]);
    expect(canAttachReviewBundle(map, 'rb-1', 'a-1')).toBe(true);
    expect(canAttachReviewBundle(map, 'rb-1', 'a-2')).toBe(false);
    expect(canAttachReviewBundle(map, 'rb-2', 'a-2')).toBe(true);
  });
});

describe('variant exposure and outcome accounting', () => {
  const assignments: Assignment[] = [
    { assignmentId: 'a1', experimentId: 'exp-1', variantId: 'var-1', assignmentKey: 'k1', converted: true, metricValue: 10 },
    { assignmentId: 'a2', experimentId: 'exp-1', variantId: 'var-1', assignmentKey: 'k2', converted: false, metricValue: 20 },
    { assignmentId: 'a3', experimentId: 'exp-1', variantId: 'var-2', assignmentKey: 'k3', converted: true, metricValue: 5 },
    { assignmentId: 'a4', experimentId: 'exp-2', variantId: 'var-1', assignmentKey: 'k4', converted: true, metricValue: 999 },
  ];

  it('accounts exposures and conversions per variant within the experiment only', () => {
    const reports = accountExposures('exp-1', assignments);
    const var1 = reports.find((r) => r.variantId === 'var-1')!;
    const var2 = reports.find((r) => r.variantId === 'var-2')!;
    expect(var1.exposures).toBe(2);
    expect(var1.conversions).toBe(1);
    expect(var2.exposures).toBe(1);
    expect(reports.every((r) => r.experimentId === 'exp-1')).toBe(true);
  });

  it('computes an average only when metric evidence exists', () => {
    const reports = accountExposures('exp-1', assignments);
    expect(averageMetric(reports.find((r) => r.variantId === 'var-1')!)).toBe(15);
    expect(averageMetric({ experimentId: 'e', variantId: 'v', exposures: 1, conversions: 0, metricSum: 0, metricCount: 0 })).toBeUndefined();
  });

  it('ignores non-finite metric values rather than corrupting the average', () => {
    const reports = accountExposures('exp-1', [
      { assignmentId: 'a', experimentId: 'exp-1', variantId: 'v', assignmentKey: 'k', converted: false, metricValue: Number.NaN },
      { assignmentId: 'b', experimentId: 'exp-1', variantId: 'v', assignmentKey: 'k2', converted: false, metricValue: 4 },
    ]);
    expect(reports[0].metricCount).toBe(1);
    expect(averageMetric(reports[0])).toBe(4);
  });

  it('selects a winner only from variants with real evidence', () => {
    const reports = accountExposures('exp-1', assignments);
    expect(selectWinner(reports)?.variantId).toBe('var-1');
    expect(selectWinner([{ experimentId: 'e', variantId: 'v', exposures: 1, conversions: 0, metricSum: 0, metricCount: 0 }])).toBeUndefined();
  });
});

describe('variant winner replay safety', () => {
  it('promotes a candidate and reports the change', () => {
    const promoted = new Set<string>();
    const result = promoteWinner(experiment({ status: 'running' }), 'var-2', promoted);
    expect(result.changed).toBe(true);
    expect(result.experiment.winnerVariantId).toBe('var-2');
    expect(result.replay).toBe(false);
  });

  it('treats re-promoting the same winner as a no-op replay', () => {
    const promoted = new Set<string>();
    const once = promoteWinner(experiment(), 'var-1', promoted).experiment;
    const twice = promoteWinner({ ...once, winnerVariantId: 'var-1' }, 'var-1', promoted);
    expect(twice.replay).toBe(true);
    expect(twice.changed).toBe(false);
  });

  it('refuses to promote a non-candidate', () => {
    expect(() => promoteWinner(experiment(), 'var-999', new Set())).toThrow(/candidate/);
  });
});

describe('variant guidance attribution and hook/timing evidence', () => {
  it('validates bounded hook/format/timing evidence', () => {
    expect(validateGuidanceEvidence({ hookType: 'question', format: 'reel', postingHourUtc: 9 })).toEqual({ ok: true, errors: [] });
    expect(validateGuidanceEvidence({ hookType: 'nonsense' }).ok).toBe(false);
    expect(validateGuidanceEvidence({ format: 'banner' }).ok).toBe(false);
    expect(validateGuidanceEvidence({ postingHourUtc: 24 }).ok).toBe(false);
    expect(validateGuidanceEvidence({ postingHourUtc: -1 }).ok).toBe(false);
    expect(GUIDANCE_LIMITS.hookTypes).toContain('question');
  });

  it('maps an hour to a timing bucket and rejects invalid hours', () => {
    expect(timingBucketForHour(3)).toBe('night');
    expect(timingBucketForHour(9)).toBe('morning');
    expect(timingBucketForHour(15)).toBe('afternoon');
    expect(timingBucketForHour(20)).toBe('evening');
    expect(() => timingBucketForHour(24)).toThrow(/0-23/);
  });

  it('attributes outcomes to the guidance receipt that produced the variant', () => {
    const evidence = new Map<string, GuidanceEvidence>([
      ['var-1', { guidanceReceiptId: 'gr-1', hookType: 'question' }],
      ['var-2', { guidanceReceiptId: 'gr-1', hookType: 'story' }],
    ]);
    const reports = accountExposures('exp-1', [
      { assignmentId: 'a1', experimentId: 'exp-1', variantId: 'var-1', assignmentKey: 'k1', converted: true, metricValue: 10 },
      { assignmentId: 'a2', experimentId: 'exp-1', variantId: 'var-2', assignmentKey: 'k2', converted: false, metricValue: 6 },
    ]);
    const attribution = attributeGuidance(evidence, reports);
    expect(attribution).toHaveLength(1);
    expect(attribution[0].guidanceReceiptId).toBe('gr-1');
    expect(attribution[0].variantIds.sort()).toEqual(['var-1', 'var-2']);
    expect(attribution[0].exposures).toBe(2);
    expect(attribution[0].conversions).toBe(1);
  });

  it('omits variants with no guidance receipt rather than inventing one', () => {
    const evidence = new Map<string, GuidanceEvidence>([['var-1', {}]]);
    const reports = accountExposures('exp-1', [
      { assignmentId: 'a', experimentId: 'exp-1', variantId: 'var-1', assignmentKey: 'k', converted: false },
    ]);
    expect(attributeGuidance(evidence, reports)).toEqual([]);
  });

  it('weights guidance metrics by their actual sample counts', () => {
    const evidence = new Map<string, GuidanceEvidence>([
      ['var-1', { guidanceReceiptId: 'gr-1' }],
      ['var-2', { guidanceReceiptId: 'gr-1' }],
    ]);
    const attribution = attributeGuidance(evidence, [
      { experimentId: 'exp-1', variantId: 'var-1', exposures: 1, conversions: 0, metricSum: 10, metricCount: 1 },
      { experimentId: 'exp-1', variantId: 'var-2', exposures: 3, conversions: 1, metricSum: 60, metricCount: 3 },
    ]);
    expect(attribution).toEqual([expect.objectContaining({ guidanceReceiptId: 'gr-1', averageMetric: 17.5 })]);
  });
});

describe('variant tenant isolation and pagination', () => {
  it('scopes visibility to the owning org and model', () => {
    expect(isExperimentVisible(experiment(), { orgId: 'org-1', modelId: 'model-1' })).toBe(true);
    expect(isExperimentVisible(experiment(), { orgId: 'org-2', modelId: 'model-1' })).toBe(false);
    expect(isExperimentVisible(experiment(), { orgId: 'org-1', modelId: 'model-2' })).toBe(false);
  });

  it('paginates experiments with an opaque cursor', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ experimentId: `exp-${i}` }));
    const page1 = paginateExperiments(rows, 2);
    expect(page1.data.map((r) => r.experimentId)).toEqual(['exp-0', 'exp-1']);
    const page2 = paginateExperiments(rows, 2, page1.nextCursor!);
    expect(page2.data.map((r) => r.experimentId)).toEqual(['exp-2', 'exp-3']);
    expect(() => paginateExperiments(rows, 0)).toThrow(/invalid page size/);
    expect(() => paginateExperiments(rows, 20, 'missing')).toThrow(/invalid experiment cursor/);
  });
});
