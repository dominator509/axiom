import { and, desc, eq, sql } from 'drizzle-orm';
import { consentRecord } from './schema/consent_record.js';
import { job } from './schema/job.js';

/**
 * A model cannot publish without the baseline legal records plus consent for
 * the specific destination platform. Keeping this policy next to the DB
 * access makes the API, MCP, and worker paths evaluate the same rule.
 */
export const REQUIRED_CONSENT_DOCUMENT_KINDS = ['2257', 'model_release', 'id_verify'] as const;

export type RequiredConsentDocumentKind = (typeof REQUIRED_CONSENT_DOCUMENT_KINDS)[number];

export type ConsentPolicyRow = {
  docKind: string;
  platform: string;
  granted: boolean;
  grantedAt: Date | string | null;
  revokedAt: Date | string | null;
  validFrom: Date | string | null;
  validTo: Date | string | null;
  expiresAt: Date | string | null;
  blobRef: string | null;
  sha256: Uint8Array | string | null;
};

export type ConsentStatus = {
  ok: boolean;
  missing: string[];
};

export type TosScanState = 'missing' | 'pending' | 'completed' | 'failed';

/**
 * Return the durable ToS scan state for a bundle.
 *
 * Approval and publication must not infer that a stored report is current:
 * generation creates the report before the queued media scan runs, and the
 * scan may still be pending (or may have failed). The newest org-scoped
 * tos.scan job is the existing durable handoff record for that work.
 */
export async function getTosScanState(
  tx: any,
  orgId: string,
  bundleId: string,
): Promise<TosScanState> {
  const rows = await tx
    .select({ state: job.state })
    .from(job)
    .where(
      and(
        eq(job.orgId, orgId),
        eq(job.kind, 'tos.scan'),
        sql`${job.payload} ->> 'bundleId' = ${bundleId}`,
      ),
    )
    .orderBy(desc(job.createdAt), desc(job.id))
    .limit(1);

  const state = rows[0]?.state;
  if (state === 'done') return 'completed';
  if (state === 'ready' || state === 'running') return 'pending';
  if (state === 'failed' || state === 'dead') return 'failed';
  return 'missing';
}

function instant(value: Date | string | null): number | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calendarDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = instant(value);
  return parsed === null ? null : new Date(parsed).toISOString().slice(0, 10);
}

function hasDocumentDigest(value: Uint8Array | string | null): boolean {
  if (value instanceof Uint8Array) return value.byteLength === 32;
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** A record is usable only while explicitly granted, unrevoked, and in date. */
export function isCurrentConsentRecord(record: ConsentPolicyRow, now = new Date()): boolean {
  if (!record.granted || record.revokedAt !== null) return false;
  if (!record.blobRef?.trim() || !hasDocumentDigest(record.sha256)) return false;

  const nowMs = now.getTime();
  const grantedAt = instant(record.grantedAt);
  if (grantedAt === null || grantedAt > nowMs) return false;

  const today = now.toISOString().slice(0, 10);
  const validFrom = calendarDate(record.validFrom);
  const validTo = calendarDate(record.validTo);
  if (validFrom === null || validFrom > today || (validTo !== null && validTo < today)) {
    return false;
  }

  const expiresAt = instant(record.expiresAt);
  return expiresAt === null || expiresAt >= nowMs;
}

/** Evaluate the complete publish precondition for one model/platform target. */
export function evaluateConsentRecords(
  records: ConsentPolicyRow[],
  platform: string,
  now = new Date(),
): ConsentStatus {
  const current = records.filter((record) => isCurrentConsentRecord(record, now));
  const missing: string[] = REQUIRED_CONSENT_DOCUMENT_KINDS.filter(
    (kind) => !current.some((record) => record.docKind === kind),
  );

  if (
    !current.some((record) => record.docKind === 'platform_consent' && record.platform === platform)
  ) {
    missing.push(`platform_consent:${platform}`);
  }

  return { ok: missing.length === 0, missing };
}

/** Load and evaluate tenant/model-scoped records inside the caller's txn. */
export async function getPublishingConsentStatus(
  tx: any,
  orgId: string,
  modelId: string,
  platform: string,
  now = new Date(),
): Promise<ConsentStatus> {
  const rows = await tx
    .select({
      docKind: consentRecord.docKind,
      platform: consentRecord.platform,
      granted: consentRecord.granted,
      grantedAt: consentRecord.grantedAt,
      revokedAt: consentRecord.revokedAt,
      validFrom: consentRecord.validFrom,
      validTo: consentRecord.validTo,
      expiresAt: consentRecord.expiresAt,
      blobRef: consentRecord.blobRef,
      sha256: consentRecord.sha256,
    })
    .from(consentRecord)
    .where(and(eq(consentRecord.orgId, orgId), eq(consentRecord.modelId, modelId)));

  return evaluateConsentRecords(rows as ConsentPolicyRow[], platform, now);
}

export function consentRequirementMessage(status: ConsentStatus, platform: string): string {
  return `publishing requires valid, in-date consent records for ${platform}: ${status.missing.join(', ')}`;
}
