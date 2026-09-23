export type ConsentExpiryStatus = 'revoked' | 'expired' | 'expiringSoon' | 'current' | 'needsReview';

export function consentExpiryStatus(
  record: { granted: boolean; revokedAt: string | null; expiresAt: string | null; validTo: string | null },
  now = new Date(),
): ConsentExpiryStatus {
  if (!record.granted || record.revokedAt !== null) return 'revoked';

  const validTo = record.validTo;
  if (validTo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) return 'needsReview';
  const expiresAt = record.expiresAt === null ? null : Date.parse(record.expiresAt);
  if (record.expiresAt !== null && (expiresAt === null || !Number.isFinite(expiresAt))) return 'needsReview';

  const today = now.toISOString().slice(0, 10);
  if ((validTo !== null && validTo < today) || (expiresAt !== null && expiresAt <= now.getTime())) {
    return 'expired';
  }
  if (expiresAt !== null && expiresAt - now.getTime() <= 30 * 24 * 60 * 60 * 1000) return 'expiringSoon';
  return 'current';
}
