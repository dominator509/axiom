import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleServiceAccountAssertion,
  fetchGa4LinkbioMetrics,
  normalizeGa4Reports,
  safeExternalProfileUrl,
} from './linkbio-integrations.js';

describe('link-in-bio provider integrations', () => {
  it('accepts only HTTPS profile URLs on the selected provider host', () => {
    expect(safeExternalProfileUrl('https://linktr.ee/creator', 'linktree')).toBe('https://linktr.ee/creator');
    expect(safeExternalProfileUrl('https://creator.beacons.ai', 'beacons')).toBe('https://creator.beacons.ai/');
    expect(safeExternalProfileUrl('http://linktr.ee/creator', 'linktree')).toBeNull();
    expect(safeExternalProfileUrl('https://beacons.ai/creator', 'linktree')).toBeNull();
    expect(safeExternalProfileUrl('https://user:pass@linktr.ee/creator', 'linktree')).toBeNull();
  });

  it('normalizes GA4 traffic and event rows into one provider-neutral daily record', () => {
    const metrics = normalizeGa4Reports(
      { rows: [{
        dimensionValues: [{ value: '20260922' }, { value: 'instagram / social' }, { value: '/links' }],
        metricValues: [{ value: '44' }, { value: '31' }],
      }] },
      { rows: [
        { dimensionValues: [{ value: '20260922' }, { value: 'instagram / social' }, { value: '/links' }, { value: 'link_click' }], metricValues: [{ value: '12' }] },
        { dimensionValues: [{ value: '20260922' }, { value: 'instagram / social' }, { value: '/links' }, { value: 'purchase' }], metricValues: [{ value: '3' }] },
      ] },
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      ts: new Date('2026-09-22T00:00:00.000Z'),
      source: 'instagram / social', target: '/links', visits: 44, uniqueVisitors: 31,
      clicks: 12, conversions: 3,
    });
    expect(metrics[0].externalEventId).toMatch(/^ga4:[a-f0-9]{64}$/);
  });

  it('fails closed on malformed GA4 dates and metric values', () => {
    expect(() => normalizeGa4Reports(
      { rows: [{ dimensionValues: [{ value: '20260231' }], metricValues: [{ value: '1' }, { value: '1' }] }] },
      { rows: [] },
    )).toThrow(/invalid date/);
    expect(() => normalizeGa4Reports(
      { rows: [{ dimensionValues: [{ value: '20260228' }], metricValues: [{ value: 'not-a-count' }, { value: '1' }] }] },
      { rows: [] },
    )).toThrow(/invalid metric/);
  });

  it('signs a short-lived Google service-account assertion for the read-only GA4 scope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const token = createGoogleServiceAccountAssertion('analytics@axiom-test.iam.gserviceaccount.com', keyPem, 1_800_000_000);
    const [header, claims, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))).toMatchObject({
      iss: 'analytics@axiom-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(() => createGoogleServiceAccountAssertion('not-an-email', keyPem)).toThrow(/email/);
  });

  it('uses the Google Data API over the supplied model egress fetcher and rejects oversized reports', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'x'.repeat(24) }))
      .mockResolvedValueOnce(Response.json({ rows: [], rowCount: 0 }))
      .mockResolvedValueOnce(Response.json({ rows: [], rowCount: 0 }));
    const result = await fetchGa4LinkbioMetrics({
      fetcher: fetcher as typeof fetch,
      propertyId: '12345678',
      clientEmail: 'analytics@axiom-test.iam.gserviceaccount.com',
      privateKey: keyPem,
      startDate: '7daysAgo',
      endDate: 'yesterday',
    });
    expect(result).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[1]?.[0])).toBe('https://analyticsdata.googleapis.com/v1beta/properties/12345678:runReport');
    const oversizedFetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'x'.repeat(24) }))
      .mockResolvedValueOnce(Response.json({ rows: [], rowCount: 10_001 }))
      .mockResolvedValueOnce(Response.json({ rows: [], rowCount: 10_001 }));
    await expect(fetchGa4LinkbioMetrics({
      fetcher: oversizedFetcher as typeof fetch,
      propertyId: '12345678',
      clientEmail: 'analytics@axiom-test.iam.gserviceaccount.com',
      privateKey: keyPem,
      startDate: '7daysAgo', endDate: 'yesterday',
    })).rejects.toThrow(/row limit/);
  });
});
