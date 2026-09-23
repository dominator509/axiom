import { describe, expect, it } from 'vitest';
import { consentExpiryStatus } from './consent-expiry';

const now = new Date('2026-09-23T12:00:00.000Z');

describe('consentExpiryStatus', () => {
  it('keeps unbounded current grants current and recognizes revoked records', () => {
    expect(consentExpiryStatus({ granted: true, revokedAt: null, expiresAt: null, validTo: null }, now)).toBe('current');
    expect(consentExpiryStatus({ granted: true, revokedAt: '2026-09-20T00:00:00.000Z', expiresAt: null, validTo: null }, now)).toBe('revoked');
  });

  it('marks expired records and date-only validTo values accurately', () => {
    expect(consentExpiryStatus({ granted: true, revokedAt: null, expiresAt: '2026-09-23T11:59:59.000Z', validTo: null }, now)).toBe('expired');
    expect(consentExpiryStatus({ granted: true, revokedAt: null, expiresAt: null, validTo: '2026-09-22' }, now)).toBe('expired');
  });

  it('warns before expiry and fails visibly closed for malformed expiry metadata', () => {
    expect(consentExpiryStatus({ granted: true, revokedAt: null, expiresAt: '2026-10-01T00:00:00.000Z', validTo: null }, now)).toBe('expiringSoon');
    expect(consentExpiryStatus({ granted: true, revokedAt: null, expiresAt: 'not-a-date', validTo: null }, now)).toBe('needsReview');
  });
});
