// ─── Shared learning evidence contract (L2.8 / F-84) ───────────────────────
//
// API, worker and dashboard code consume the same bounded vocabulary.  The
// contract deliberately distinguishes the legacy learn-v1 namespace from the
// richer learn-v2 namespace so old rows remain readable and are never mixed
// with richer evidence by accident.

export const GUIDANCE_LIMITS = {
  hookTypes: ['question', 'bold-claim', 'story', 'stat', 'controversy', 'teaser'],
  formats: ['reel', 'carousel', 'single', 'story', 'longform'],
} as const;

export type GuidanceHookType = (typeof GUIDANCE_LIMITS.hookTypes)[number];
export type GuidanceFormat = (typeof GUIDANCE_LIMITS.formats)[number];
export type TimingBucket = 'morning' | 'afternoon' | 'evening' | 'night';
export type LearningVersion = 'learn-v1' | 'learn-v2';
export type CaptionLength = 'short' | 'medium' | 'long';
export type CaptionShape = 'question' | 'statement';

export interface GuidanceEvidence {
  /** The server-owned receipt used to attribute a variant, when available. */
  guidanceReceiptId?: string;
  /** Kept string-shaped at the boundary so invalid persisted values can be rejected at runtime. */
  hookType?: string;
  format?: string;
  postingHourUtc?: number;
  timingBucket?: TimingBucket;
}

export interface ParsedLearningArm {
  version: LearningVersion;
  captionLength: CaptionLength;
  captionShape: CaptionShape;
  hookType?: GuidanceHookType;
  format?: GuidanceFormat;
  timingBucket?: TimingBucket;
}

const TIMING_BUCKETS: readonly TimingBucket[] = ['morning', 'afternoon', 'evening', 'night'];

export function timingBucketForHour(hourUtc: number): TimingBucket {
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) throw new Error('hour must be an integer 0-23');
  if (hourUtc < 6) return 'night';
  if (hourUtc < 12) return 'morning';
  if (hourUtc < 18) return 'afternoon';
  return 'evening';
}

/** Validate bounded evidence without inferring values that are not present. */
export function validateGuidanceEvidence(evidence: GuidanceEvidence): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (evidence.guidanceReceiptId !== undefined
    && (typeof evidence.guidanceReceiptId !== 'string' || evidence.guidanceReceiptId.length < 1 || evidence.guidanceReceiptId.length > 128)) {
    errors.push('guidanceReceiptId must be 1-128 characters');
  }
  if (evidence.hookType !== undefined && !(GUIDANCE_LIMITS.hookTypes as readonly string[]).includes(evidence.hookType)) {
    errors.push('unknown hook type');
  }
  if (evidence.format !== undefined && !(GUIDANCE_LIMITS.formats as readonly string[]).includes(evidence.format)) {
    errors.push('unknown format');
  }
  if (evidence.postingHourUtc !== undefined
    && (!Number.isInteger(evidence.postingHourUtc) || evidence.postingHourUtc < 0 || evidence.postingHourUtc > 23)) {
    errors.push('postingHourUtc must be an integer 0-23');
  }
  if (evidence.timingBucket !== undefined && !TIMING_BUCKETS.includes(evidence.timingBucket)) {
    errors.push('unknown timing bucket');
  }
  if (evidence.postingHourUtc !== undefined && evidence.timingBucket !== undefined
    && Number.isInteger(evidence.postingHourUtc) && evidence.postingHourUtc >= 0 && evidence.postingHourUtc <= 23
    && timingBucketForHour(evidence.postingHourUtc) !== evidence.timingBucket) {
    errors.push('timing bucket does not match postingHourUtc');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Convert an untrusted value into bounded evidence.  Invalid evidence is
 * rejected as a whole; partial fields are never silently promoted into a
 * learning arm.
 */
export function sanitizeGuidanceEvidence(value: unknown): GuidanceEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const evidence: GuidanceEvidence = {};
  const strings = ['guidanceReceiptId', 'hookType', 'format'] as const;
  for (const key of strings) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'string' || raw[key].trim() !== raw[key]) return null;
      (evidence as Record<string, unknown>)[key] = raw[key];
    }
  }
  if (raw.postingHourUtc !== undefined) {
    if (typeof raw.postingHourUtc !== 'number') return null;
    evidence.postingHourUtc = raw.postingHourUtc;
  }
  if (raw.timingBucket !== undefined) {
    if (typeof raw.timingBucket !== 'string') return null;
    evidence.timingBucket = raw.timingBucket as TimingBucket;
  }
  const checked = validateGuidanceEvidence(evidence);
  return checked.ok && Object.keys(evidence).length > 0 ? evidence : null;
}

export function learningContextBucket(context: unknown): number | 'unknown' | null {
  if (typeof context !== 'string') return null;
  const match = /^learn-v[12]:scheduled-utc-(unknown|[0-3])$/.exec(context);
  if (!match) return null;
  return match[1] === 'unknown' ? 'unknown' : Number(match[1]);
}

export function isLearningContext(value: unknown): value is string {
  return learningContextBucket(value) !== null;
}

export function parseLearningArm(value: unknown): ParsedLearningArm | null {
  if (typeof value !== 'string') return null;
  const legacy = /^(short|medium|long):(question|statement)$/.exec(value);
  if (legacy) return {
    version: 'learn-v1',
    captionLength: legacy[1] as CaptionLength,
    captionShape: legacy[2] as CaptionShape,
  };
  const rich = /^v2:(short|medium|long):(question|statement):hook=([a-z-]+|unknown):format=([a-z-]+|unknown)(?::time=(morning|afternoon|evening|night))?$/.exec(value);
  if (!rich) return null;
  const hookType = rich[3] === 'unknown' ? undefined : rich[3] as GuidanceHookType;
  const format = rich[4] === 'unknown' ? undefined : rich[4] as GuidanceFormat;
  const timingBucket = rich[5] as TimingBucket | undefined;
  if (hookType && !(GUIDANCE_LIMITS.hookTypes as readonly string[]).includes(hookType)) return null;
  if (format && !(GUIDANCE_LIMITS.formats as readonly string[]).includes(format)) return null;
  return {
    version: 'learn-v2',
    captionLength: rich[1] as CaptionLength,
    captionShape: rich[2] as CaptionShape,
    hookType,
    format,
    ...(timingBucket ? { timingBucket } : {}),
  };
}

export function isLearningArm(value: unknown): value is string {
  return parseLearningArm(value) !== null;
}
