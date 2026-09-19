import { describe, expect, it } from 'vitest';
import {
  evaluateConsentRecords,
  getTosScanState,
  isCurrentConsentRecord,
  type ConsentPolicyRow,
} from './compliance.js';

const digest = new Uint8Array(32);

function record(overrides: Partial<ConsentPolicyRow> = {}): ConsentPolicyRow {
  return {
    docKind: '2257',
    platform: 'all',
    granted: true,
    grantedAt: '2026-09-01T00:00:00.000Z',
    revokedAt: null,
    validFrom: '2026-09-01',
    validTo: '2026-12-31',
    expiresAt: '2026-12-31T23:59:59.000Z',
    blobRef: 'consent/model-1/2257.pdf',
    sha256: digest,
    ...overrides,
  };
}

function txFor(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  };
}

describe('consent publication policy', () => {
  it('accepts the complete current record set for a platform', () => {
    const records = [
      record({ docKind: '2257' }),
      record({ docKind: 'model_release' }),
      record({ docKind: 'id_verify' }),
      record({ docKind: 'platform_consent', platform: 'instagram' }),
    ];

    expect(evaluateConsentRecords(records, 'instagram', new Date('2026-09-07T12:00:00Z'))).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('reports missing baseline and destination-specific records', () => {
    const result = evaluateConsentRecords(
      [record({ docKind: '2257' })],
      'instagram',
      new Date('2026-09-07T12:00:00Z'),
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['model_release', 'id_verify', 'platform_consent:instagram']);
  });

  it.each([
    { label: 'revoked', overrides: { revokedAt: '2026-09-02T00:00:00Z' } },
    { label: 'expired', overrides: { expiresAt: '2026-09-06T23:59:59Z' } },
    { label: 'not yet valid', overrides: { validFrom: '2026-09-08' } },
    { label: 'missing vault object', overrides: { blobRef: null } },
    { label: 'invalid digest', overrides: { sha256: new Uint8Array(31) } },
  ])('rejects a $label record', ({ overrides }) => {
    expect(isCurrentConsentRecord(record(overrides), new Date('2026-09-07T12:00:00Z'))).toBe(false);
  });
});

describe('getTosScanState', () => {
  it('recognizes a completed scan job', async () => {
    await expect(getTosScanState(txFor([{ state: 'done' }]), 'org-1', 'bundle-1')).resolves.toBe(
      'completed',
    );
  });

  it('keeps ready and running scans pending', async () => {
    await expect(getTosScanState(txFor([{ state: 'ready' }]), 'org-1', 'bundle-1')).resolves.toBe(
      'pending',
    );
    await expect(getTosScanState(txFor([{ state: 'running' }]), 'org-1', 'bundle-1')).resolves.toBe(
      'pending',
    );
  });

  it('fails closed for failed or missing scan jobs', async () => {
    await expect(getTosScanState(txFor([{ state: 'failed' }]), 'org-1', 'bundle-1')).resolves.toBe(
      'failed',
    );
    await expect(getTosScanState(txFor([]), 'org-1', 'bundle-1')).resolves.toBe('missing');
  });
});
