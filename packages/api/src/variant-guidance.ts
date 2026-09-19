import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CaptionGuidanceReceipt } from '@axiom/db/schema';
import { timingBucketForHour, validateGuidanceEvidence, type GuidanceEvidence } from './variant-ab-contract.js';

/**
 * Guidance provenance is deliberately smaller than the source receipt. It is
 * enough to re-check the source bundle and attribute observations without
 * copying captions, exemplars, provider payloads, or private storage data into
 * an asset variant.
 */
export interface StoredVariantGuidance {
  version: 'caption-guidance-v1';
  sourceBundleId: string;
  sourceVariantId: string | null;
  platform: string;
  selectedArm: string | null;
  context: string;
  captionSha256: string;
  hookType?: string;
  format?: string;
  postingHourUtc?: number;
  timingBucket?: 'morning' | 'afternoon' | 'evening' | 'night';
}

export interface VariantGuidanceSummary {
  guidanceReceiptId: string;
  sourceBundleId: string;
  sourceVariantId: string | null;
  platform: string;
  selectedArm: string | null;
  context: string;
  hookType?: string;
  format?: string;
  postingHourUtc?: number;
  timingBucket?: 'morning' | 'afternoon' | 'evening' | 'night';
}

export interface GuidanceSourceBundle {
  id: string;
  sourceVariantId?: string | null;
  assetId?: string | null;
  captions?: unknown;
  captionGuidance?: unknown;
}

const receiptSchema = z.object({
  version: z.literal('caption-guidance-v1'),
  selectedArm: z.string().regex(/^(short|medium|long):(question|statement)$/).nullable(),
  context: z.string().regex(/^learn-v1:scheduled-utc-(unknown|[0-3])$/),
  exemplarIds: z.array(z.string().uuid()).max(50),
  captionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  hookType: z.string().trim().min(1).max(32).optional(),
  format: z.string().trim().min(1).max(32).optional(),
  postingHourUtc: z.number().int().min(0).max(23).optional(),
  timingBucket: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(),
}).strict();

const provenanceSchema = receiptSchema.omit({ exemplarIds: true }).extend({
  sourceBundleId: z.string().uuid(),
  sourceVariantId: z.string().uuid().nullable(),
  platform: z.string().min(1).max(50),
}).strict();

export function captionSha256(caption: string): string {
  return createHash('sha256').update(caption, 'utf8').digest('hex');
}

function evidenceFromReceipt(receipt: Pick<CaptionGuidanceReceipt, 'hookType' | 'format' | 'postingHourUtc' | 'timingBucket'>): GuidanceEvidence {
  const evidence: GuidanceEvidence = {};
  if (receipt.hookType !== undefined) evidence.hookType = receipt.hookType;
  if (receipt.format !== undefined) evidence.format = receipt.format;
  if (receipt.postingHourUtc !== undefined) evidence.postingHourUtc = receipt.postingHourUtc;
  if (receipt.timingBucket !== undefined) evidence.timingBucket = receipt.timingBucket;
  return evidence;
}

function validTiming(evidence: GuidanceEvidence): boolean {
  if (evidence.postingHourUtc === undefined || evidence.timingBucket === undefined) return true;
  return timingBucketForHour(evidence.postingHourUtc) === evidence.timingBucket;
}

function summaryFromProvenance(provenance: StoredVariantGuidance): VariantGuidanceSummary {
  const { captionSha256: _captionSha256, ...safe } = provenance;
  void _captionSha256;
  return { guidanceReceiptId: `${provenance.sourceBundleId}:${provenance.platform}`, ...safe };
}

/**
 * Re-check a guidance receipt against the exact server-owned caption. This is
 * the only constructor for stored variant guidance; callers must not accept a
 * client-provided receipt as provenance.
 */
export function readVerifiedGuidance(
  sourceBundle: GuidanceSourceBundle,
  platform: string,
  copyText: string,
): { receipt: CaptionGuidanceReceipt; provenance: StoredVariantGuidance; summary: VariantGuidanceSummary } | null {
  const captions = sourceBundle.captions;
  const receipts = sourceBundle.captionGuidance;
  const caption = captions && typeof captions === 'object' ? (captions as Record<string, unknown>)[platform] : undefined;
  const rawReceipt = receipts && typeof receipts === 'object' ? (receipts as Record<string, unknown>)[platform] : undefined;
  if (typeof caption !== 'string' || caption !== copyText) return null;
  const parsed = receiptSchema.safeParse(rawReceipt);
  if (!parsed.success || parsed.data.captionSha256 !== captionSha256(copyText)) return null;
  const evidence = evidenceFromReceipt(parsed.data);
  if (!validateGuidanceEvidence(evidence).ok || !validTiming(evidence)) return null;

  const provenance: StoredVariantGuidance = {
    version: parsed.data.version,
    sourceBundleId: sourceBundle.id,
    sourceVariantId: sourceBundle.sourceVariantId ?? null,
    platform,
    selectedArm: parsed.data.selectedArm,
    context: parsed.data.context,
    captionSha256: parsed.data.captionSha256,
    ...evidence,
  };
  return { receipt: parsed.data, provenance, summary: summaryFromProvenance(provenance) };
}

/** Project only safe, bounded attribution data from asset_variant.settings. */
export function projectStoredVariantGuidance(settings: unknown): VariantGuidanceSummary | null {
  if (!settings || typeof settings !== 'object') return null;
  const raw = (settings as Record<string, unknown>).guidance;
  const parsed = provenanceSchema.safeParse(raw);
  if (!parsed.success) return null;
  const evidence = evidenceFromReceipt(parsed.data);
  if (!validateGuidanceEvidence(evidence).ok || !validTiming(evidence)) return null;
  return summaryFromProvenance(parsed.data);
}

/** Compare all persisted provenance fields, including the caption fingerprint. */
export function sameGuidanceProvenance(left: unknown, right: StoredVariantGuidance): boolean {
  const parsed = provenanceSchema.safeParse(left);
  if (!parsed.success) return false;
  const keys: (keyof StoredVariantGuidance)[] = [
    'version', 'sourceBundleId', 'sourceVariantId', 'platform', 'selectedArm', 'context',
    'captionSha256', 'hookType', 'format', 'postingHourUtc', 'timingBucket',
  ];
  return keys.every(key => parsed.data[key] === right[key]);
}
