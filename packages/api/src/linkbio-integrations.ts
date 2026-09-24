import { createHash, createSign } from 'node:crypto';
import { readBoundedResponseJson } from '@axiom/core';

export const LINKBIO_PROVIDER_KINDS = ['native', 'fanlynks', 'linktree', 'beacons'] as const;
export type LinkbioProviderKind = typeof LINKBIO_PROVIDER_KINDS[number];

export type LinkbioMetric = {
  externalEventId: string;
  ts: Date;
  source: string;
  target: string;
  visits: number;
  uniqueVisitors: number;
  clicks: number;
  conversions: number;
};

export type Ga4ReportRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

export type Ga4Report = { rows?: Ga4ReportRow[]; rowCount?: number };

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GA4_REPORT_URL = 'https://analyticsdata.googleapis.com/v1beta/properties';
const MAX_GA4_ROWS = 10_000;

export function safeExternalProfileUrl(value: string, provider: LinkbioProviderKind): string | null {
  if (provider !== 'linktree' && provider !== 'beacons') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) return null;
    const host = url.hostname.toLowerCase();
    if (provider === 'linktree' && host !== 'linktr.ee' && !host.endsWith('.linktr.ee')) return null;
    if (provider === 'beacons' && host !== 'beacons.ai' && !host.endsWith('.beacons.ai')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function createGoogleServiceAccountAssertion(
  clientEmail: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    throw new Error('Google service account email is invalid');
  }
  const pem = privateKey.replace(/\\n/g, '\n').trim();
  if (!pem.startsWith('-----BEGIN PRIVATE KEY-----') || !pem.includes('-----END PRIVATE KEY-----')) {
    throw new Error('Google service account private key is invalid');
  }
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: clientEmail,
    scope: GA4_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3_600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(pem).toString('base64url');
  return `${unsigned}.${signature}`;
}

function metricValue(row: Ga4ReportRow, index: number): number {
  const raw = row.metricValues?.[index]?.value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error('Google Analytics returned an invalid metric');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Google Analytics returned an invalid metric');
  return value;
}

function dimensionValue(row: Ga4ReportRow, index: number): string {
  const value = row.dimensionValues?.[index]?.value;
  return typeof value === 'string' ? value.slice(0, 500) : '';
}

function metricKey(date: string, source: string, target: string): string {
  return `${date}\u0000${source}\u0000${target}`;
}

function utcDate(value: string): Date {
  if (!/^\d{8}$/.test(value)) throw new Error('Google Analytics returned an invalid date');
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== value) {
    throw new Error('Google Analytics returned an invalid date');
  }
  return date;
}

export function normalizeGa4Reports(
  traffic: Ga4Report,
  events: Ga4Report,
  clickEventName = 'link_click',
  conversionEventNames: string[] = ['purchase', 'generate_lead'],
): LinkbioMetric[] {
  const rows = new Map<string, LinkbioMetric>();
  for (const row of traffic.rows ?? []) {
    const dateText = dimensionValue(row, 0);
    const source = dimensionValue(row, 1) || '(direct)';
    const target = dimensionValue(row, 2) || '/';
    const key = metricKey(dateText, source, target);
    const ts = utcDate(dateText);
    rows.set(key, {
      externalEventId: `ga4:${createHash('sha256').update(key).digest('hex')}`,
      ts,
      source,
      target,
      visits: metricValue(row, 0),
      uniqueVisitors: metricValue(row, 1),
      clicks: 0,
      conversions: 0,
    });
  }
  for (const row of events.rows ?? []) {
    const dateText = dimensionValue(row, 0);
    const source = dimensionValue(row, 1) || '(direct)';
    const target = dimensionValue(row, 2) || '/';
    const eventName = dimensionValue(row, 3);
    const key = metricKey(dateText, source, target);
    const existing = rows.get(key) ?? {
      externalEventId: `ga4:${createHash('sha256').update(key).digest('hex')}`,
      ts: utcDate(dateText), source, target, visits: 0, uniqueVisitors: 0, clicks: 0, conversions: 0,
    };
    const count = metricValue(row, 0);
    if (eventName === clickEventName) existing.clicks += count;
    if (conversionEventNames.includes(eventName)) existing.conversions += count;
    rows.set(key, existing);
  }
  return [...rows.values()];
}

async function readOkJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return readBoundedResponseJson<T>(response);
}

async function runGa4Report(
  fetcher: typeof fetch,
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<Ga4Report> {
  const response = await fetcher(`${GA4_REPORT_URL}/${encodeURIComponent(propertyId)}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, limit: MAX_GA4_ROWS }),
    signal: AbortSignal.timeout(30_000),
  });
  const report = await readOkJson<Ga4Report>(response, 'Google Analytics report');
  if (typeof report.rowCount === 'number' && report.rowCount > MAX_GA4_ROWS) {
    throw new Error('Google Analytics report exceeded the supported row limit');
  }
  if (!Array.isArray(report.rows)) throw new Error('Google Analytics report has no rows');
  return report;
}

export async function fetchGa4LinkbioMetrics(args: {
  fetcher: typeof fetch;
  propertyId: string;
  clientEmail: string;
  privateKey: string;
  startDate: string;
  endDate: string;
  clickEventName?: string;
  conversionEventNames?: string[];
}): Promise<LinkbioMetric[]> {
  if (!/^\d{4,20}$/.test(args.propertyId)) throw new Error('Google Analytics property ID is invalid');
  const assertion = createGoogleServiceAccountAssertion(args.clientEmail, args.privateKey);
  const tokenResponse = await args.fetcher(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = await readOkJson<{ access_token?: string }>(tokenResponse, 'Google OAuth token exchange');
  if (typeof token.access_token !== 'string' || token.access_token.length < 20) {
    throw new Error('Google OAuth token response is incomplete');
  }

  const dateRanges = [{ startDate: args.startDate, endDate: args.endDate }];
  const [traffic, events] = await Promise.all([
    runGa4Report(args.fetcher, token.access_token, args.propertyId, {
      dateRanges,
      dimensions: [{ name: 'date' }, { name: 'sessionSourceMedium' }, { name: 'pagePath' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    }),
    runGa4Report(args.fetcher, token.access_token, args.propertyId, {
      dateRanges,
      dimensions: [{ name: 'date' }, { name: 'sessionSourceMedium' }, { name: 'pagePath' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
    }),
  ]);
  return normalizeGa4Reports(
    traffic,
    events,
    args.clickEventName ?? 'link_click',
    args.conversionEventNames ?? ['purchase', 'generate_lead'],
  );
}
