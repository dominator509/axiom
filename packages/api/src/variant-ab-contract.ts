// ─── Variant / A-B experiment contract ────────────────────────────────────
//
// Extends EXISTING asset_variant / variant_experiment / publication-attribution
// state. No parallel media state is created. A pure contract: no publication,
// no provider call, no runtime service.

import {
  GUIDANCE_LIMITS,
  timingBucketForHour,
  validateGuidanceEvidence,
  type GuidanceEvidence,
} from '@axiom/core';

export { GUIDANCE_LIMITS, timingBucketForHour, validateGuidanceEvidence };
export type { GuidanceEvidence };

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';
export type EvaluationPolicy = 'manual' | 'fixed-post-engagement-v1';
export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'x' | 'facebook' | 'reddit' | 'threads' | 'discord' | 'telegram' | 'snapchat' | 'fanvue';

export interface Experiment {
  experimentId: string;
  orgId: string;
  modelId: string;
  name: string;
  platform: string;
  status: ExperimentStatus;
  evaluationPolicy: EvaluationPolicy;
  variantIds: string[];
  winnerVariantId?: string;
  createdAt: string;
}

export interface Assignment {
  assignmentId: string;
  experimentId: string;
  variantId: string;
  assignmentKey: string;
  reviewBundleId?: string;
  converted: boolean;
  metricValue?: number;
  outcomeAt?: string;
}

/** Ownership/consent must hold before a candidate can be used. */
export interface CandidateGuard {
  variantId: string;
  ownedByModel: boolean;
  consentPresent: boolean;
}

export interface ExperimentContext {
  orgId: string;
  modelId: string;
  platform: string;
  /** Platforms this experiment may actually run on. */
  capabilityAllows: boolean;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

export function canTransitionExperiment(from: ExperimentStatus, to: ExperimentStatus): boolean {
  const allowed: Record<ExperimentStatus, ExperimentStatus[]> = {
    draft: ['running', 'completed'],
    running: ['paused', 'completed'],
    paused: ['running', 'completed'],
    completed: [],
  };
  return from === to || allowed[from].includes(to);
}

/**
 * Validate a lifecycle transition with scope, candidate ownership/consent and
 * platform capability. An experiment control never publishes anything.
 */
export interface TransitionCheck {
  ok: boolean;
  reason?: 'invalid_transition' | 'scope_mismatch' | 'candidate_not_owned' | 'consent_missing' | 'platform_unsupported' | 'no_candidates';
}

export function validateExperimentTransition(
  experiment: Experiment,
  to: ExperimentStatus,
  ctx: ExperimentContext,
  candidates: CandidateGuard[],
): TransitionCheck {
  if (!canTransitionExperiment(experiment.status, to)) return { ok: false, reason: 'invalid_transition' };
  if (experiment.orgId !== ctx.orgId || experiment.modelId !== ctx.modelId) return { ok: false, reason: 'scope_mismatch' };
  if (!ctx.capabilityAllows) return { ok: false, reason: 'platform_unsupported' };

  if (to === 'running') {
    if (experiment.variantIds.length === 0) return { ok: false, reason: 'no_candidates' };
    if (candidates.some((c) => !c.ownedByModel)) return { ok: false, reason: 'candidate_not_owned' };
    if (candidates.some((c) => !c.consentPresent)) return { ok: false, reason: 'consent_missing' };
  }
  return { ok: true };
}

/** Experiment state must never be a publication trigger. */
export function experimentPublishesDirectly(): false {
  return false;
}

// ─── Candidate assignment & idempotency ───────────────────────────────────

/** Claim an assignment key exactly once per experiment. */
export function claimAssignment(seen: Set<string>, experimentId: string, assignmentKey: string): boolean {
  if (!assignmentKey || typeof assignmentKey !== 'string') return false;
  const key = `${experimentId}:${assignmentKey}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/** A review bundle can be attached to only one assignment. */
export function canAttachReviewBundle(
  existingByReviewBundle: Map<string, string>,
  reviewBundleId: string,
  assignmentId: string,
): boolean {
  const owner = existingByReviewBundle.get(reviewBundleId);
  return owner === undefined || owner === assignmentId;
}

// ─── Exposure / outcome accounting ────────────────────────────────────────

export interface ExposureReport {
  experimentId: string;
  variantId: string;
  exposures: number;
  conversions: number;
  metricSum: number;
  metricCount: number;
}

/**
 * Aggregate assignment outcomes per variant. Frozen evidence is respected:
 * manual self-reports are already excluded upstream and are not re-counted here.
 */
export function accountExposures(
  experimentId: string,
  assignments: Assignment[],
): ExposureReport[] {
  const byVariant = new Map<string, ExposureReport>();
  for (const assignment of assignments) {
    if (assignment.experimentId !== experimentId) continue;
    const report = byVariant.get(assignment.variantId) ?? {
      experimentId,
      variantId: assignment.variantId,
      exposures: 0,
      conversions: 0,
      metricSum: 0,
      metricCount: 0,
    };
    report.exposures += 1;
    if (assignment.converted) report.conversions += 1;
    if (typeof assignment.metricValue === 'number' && Number.isFinite(assignment.metricValue)) {
      report.metricSum += assignment.metricValue;
      report.metricCount += 1;
    }
    byVariant.set(assignment.variantId, report);
  }
  return [...byVariant.values()];
}

/** Average metric for a variant, or undefined when there is no evidence. */
export function averageMetric(report: ExposureReport): number | undefined {
  return report.metricCount === 0 ? undefined : report.metricSum / report.metricCount;
}

/** Winner selection by average metric, ignoring variants with no evidence. */
export function selectWinner(reports: ExposureReport[]): ExposureReport | undefined {
  const eligible = reports.filter((r) => r.metricCount > 0);
  if (eligible.length === 0) return undefined;
  return eligible.reduce((best, current) => {
    const bestAvg = averageMetric(best) ?? Number.NEGATIVE_INFINITY;
    const currentAvg = averageMetric(current) ?? Number.NEGATIVE_INFINITY;
    return currentAvg > bestAvg ? current : best;
  });
}

/**
 * Winner promotion is replay-safe: re-promoting the same winner is a no-op, and
 * a different winner replaces the previous one only as a new promotion event.
 */
export function promoteWinner(
  experiment: Experiment,
  winnerVariantId: string,
  alreadyPromoted: Set<string>,
): { changed: boolean; experiment: Experiment; replay: boolean } {
  if (!experiment.variantIds.includes(winnerVariantId)) {
    throw new Error('winner must be one of the experiment candidates');
  }
  const key = `${experiment.experimentId}:${winnerVariantId}`;
  const replay = alreadyPromoted.has(key);
  if (replay && experiment.winnerVariantId === winnerVariantId) {
    return { changed: false, experiment, replay: true };
  }
  alreadyPromoted.add(key);
  return {
    changed: experiment.winnerVariantId !== winnerVariantId,
    experiment: { ...experiment, winnerVariantId, status: experiment.status === 'completed' ? 'completed' : experiment.status },
    replay: false,
  };
}

// ─── Selected-guidance attribution & hook/timing evidence ─────────────────

/**
 * Attribute outcomes back to the guidance receipt that produced a variant, so
 * selected-guidance effectiveness is auditable.
 */
export interface GuidanceAttribution {
  guidanceReceiptId: string;
  variantIds: string[];
  exposures: number;
  conversions: number;
  averageMetric?: number;
}

export function attributeGuidance(
  evidenceByVariant: Map<string, GuidanceEvidence>,
  reports: ExposureReport[],
): GuidanceAttribution[] {
  const byReceipt = new Map<string, GuidanceAttribution>();
  for (const report of reports) {
    const evidence = evidenceByVariant.get(report.variantId);
    if (!evidence?.guidanceReceiptId) continue;
    const entry = byReceipt.get(evidence.guidanceReceiptId) ?? {
      guidanceReceiptId: evidence.guidanceReceiptId,
      variantIds: [],
      exposures: 0,
      conversions: 0,
    };
    if (!entry.variantIds.includes(report.variantId)) entry.variantIds.push(report.variantId);
    entry.exposures += report.exposures;
    entry.conversions += report.conversions;
    const avg = averageMetric(report);
    if (avg !== undefined) {
      entry.averageMetric = entry.averageMetric === undefined
        ? avg
        : (entry.averageMetric + avg) / 2;
    }
    byReceipt.set(evidence.guidanceReceiptId, entry);
  }
  return [...byReceipt.values()];
}

// ─── Tenant isolation & bounded pagination ────────────────────────────────

/** Experiments/assignments are readable only within their own org and model. */
export function isExperimentVisible(experiment: Experiment, ctx: { orgId: string; modelId: string }): boolean {
  return experiment.orgId === ctx.orgId && experiment.modelId === ctx.modelId;
}

export function paginateExperiments<T extends { experimentId: string }>(
  rows: T[],
  pageSize = 20,
  cursor?: string,
): { data: T[]; nextCursor: string | null } {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page size');
  let start = 0;
  if (cursor) {
    const index = rows.findIndex((r) => r.experimentId === cursor);
    if (index === -1) throw new Error('invalid experiment cursor');
    start = index + 1;
  }
  const slice = rows.slice(start, start + pageSize + 1);
  const hasMore = slice.length > pageSize;
  const data = slice.slice(0, pageSize);
  return { data, nextCursor: hasMore ? data[data.length - 1].experimentId : null };
}
