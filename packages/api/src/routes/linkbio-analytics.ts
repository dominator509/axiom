import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { fetchGa4LinkbioMetrics, LINKBIO_PROVIDER_KINDS, type LinkbioProviderKind } from '../linkbio-integrations.js';
import { buildEgressFetch, resolveEgressBinding } from '@axiom/llm-gateway';
import { readBoundedResponseJson } from '@axiom/core';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { decryptOAuthCredentials, encryptOAuthCredentials } from './oauth-connection.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const credentialSchema = z.object({
  propertyId: z.string().regex(/^\d{4,20}$/),
  clientEmail: z.string().email().max(254),
  privateKey: z.string().min(100).max(8_000),
  clickEventName: z.string().trim().min(1).max(80).default('link_click'),
  conversionEventNames: z.array(z.string().trim().min(1).max(80)).max(12).default(['purchase', 'generate_lead']),
}).strict();
const fanlynksCredentialSchema = z.object({
  profileUrl: z.string().url().max(2048),
  apiToken: z.string().regex(/^flx_axm_[A-Za-z0-9_-]{43}$/),
}).strict();
const connectionSchema = z.union([credentialSchema, fanlynksCredentialSchema]);
const syncSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
}).strict();
const credentialRoles = new Set(['owner', 'manager']);
const syncRoles = new Set(['owner', 'manager', 'operator']);
const MAX_FANLYNKS_ROWS = 10_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

function linkbioKind(raw: string): LinkbioProviderKind | null {
  return LINKBIO_PROVIDER_KINDS.includes(raw as LinkbioProviderKind) ? raw as LinkbioProviderKind : null;
}

function validSyncWindow(startDate: string, endDate: string): boolean {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const span = end - start;
  return Number.isFinite(span) && span >= 0 && span <= 89 * 24 * 60 * 60 * 1000
    && end <= Date.now();
}

function fanlynksOrigin(profileUrl: string): string | null {
  try {
    const url = new URL(profileUrl);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

type FanlynksMetric = {
  ts: Date;
  source: string;
  target: string;
  utmSource: string;
  externalEventId: string;
  visits: number;
  uniqueVisitors: 0;
  clicks: number;
  conversions: 0;
};

function fanlynksMetricsFromResponse(value: unknown, startDate: string, endDate: string): FanlynksMetric[] {
  if (!value || typeof value !== 'object') throw new Error('FanLynks analytics response is not an object');
  const envelope = value as { ok?: unknown; data?: unknown };
  if (envelope.ok !== true || !envelope.data || typeof envelope.data !== 'object') {
    throw new Error('FanLynks analytics response is incomplete');
  }
  const data = envelope.data as { sources?: unknown; metricCoverage?: unknown };
  const coverage = data.metricCoverage as Record<string, unknown> | null;
  if (!coverage || coverage.pageViews !== true || coverage.clicks !== true
    || coverage.uniqueVisitors !== false || coverage.conversions !== false) {
    throw new Error('FanLynks analytics metric coverage does not match the supported contract');
  }
  if (!Array.isArray(data.sources) || data.sources.length > MAX_FANLYNKS_ROWS) {
    throw new Error('FanLynks analytics source rows exceed the supported limit');
  }
  const endExclusive = new Date(`${endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const seen = new Set<string>();
  return data.sources.map((value): FanlynksMetric => {
    if (!value || typeof value !== 'object') throw new Error('FanLynks analytics row is invalid');
    const row = value as Record<string, unknown>;
    const date = row.date;
    const source = row.source;
    const medium = row.medium;
    const pageViews = row.pageViews;
    const clicks = row.clicks;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
      || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date
      || date < startDate || date >= endExclusive.toISOString().slice(0, 10)
      || typeof source !== 'string' || source.length > 160
      || typeof medium !== 'string' || medium.length > 160
      || !Number.isSafeInteger(pageViews) || Number(pageViews) < 0 || Number(pageViews) > MAX_POSTGRES_INTEGER
      || !Number.isSafeInteger(clicks) || Number(clicks) < 0 || Number(clicks) > MAX_POSTGRES_INTEGER) {
      throw new Error('FanLynks analytics row does not match the supported contract');
    }
    const key = `${date}\u0000${source}\u0000${medium}`;
    if (seen.has(key)) throw new Error('FanLynks analytics response contains duplicate source rows');
    seen.add(key);
    return {
      ts: new Date(`${date}T00:00:00.000Z`),
      source: 'fanlynks',
      target: `${source} / ${medium}`.slice(0, 360),
      utmSource: source,
      externalEventId: `fanlynks-${createHash('sha256').update(key).digest('hex')}`,
      visits: Number(pageViews), uniqueVisitors: 0, clicks: Number(clicks), conversions: 0,
    };
  });
}

router.get('/models/:modelId/linkbio/:kind/analytics-connection', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const kind = linkbioKind(c.req.param('kind'));
  if (!kind) return apiError(c, 404, statusTitle(404), 'unknown link-in-bio provider');
  if (kind === 'native') return apiError(c, 422, statusTitle(422), 'GA4 connection is available for Fanlynks, Linktree, and Beacons pages');
  const role = c.get('role') ?? '';
  if (!syncRoles.has(role)) return apiError(c, 403, statusTitle(403), 'role cannot read link-in-bio analytics settings');
  const rows = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, c.req.param('modelId'))) !== orgId) return [];
    return tx.select({
      id: schema.linkbioProvider.id,
      enabled: schema.linkbioProvider.enabled,
      status: schema.linkbioProvider.status,
      config: schema.linkbioProvider.config,
      credentialsEnc: schema.linkbioProvider.credentialsEnc,
      fanlynksTokenEnc: schema.linkbioProvider.fanlynksTokenEnc,
      fanlynksAnalyticsStatus: schema.linkbioProvider.fanlynksAnalyticsStatus,
      fanlynksLastSyncedAt: schema.linkbioProvider.fanlynksLastSyncedAt,
      profileUrl: schema.linkbioProvider.profileUrl,
      lastSyncedAt: schema.linkbioProvider.lastSyncedAt,
    }).from(schema.linkbioProvider).where(and(
      eq(schema.linkbioProvider.orgId, orgId),
      eq(schema.linkbioProvider.modelId, c.req.param('modelId')),
      eq(schema.linkbioProvider.kind, kind),
    )).limit(1);
  });
  const provider = rows[0];
  if (!provider) return apiError(c, 404, statusTitle(404), 'provider is not configured');
  const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
    ? provider.config as Record<string, unknown> : {};
  return c.json({ data: {
    kind,
    enabled: provider.enabled,
    status: provider.status,
    analyticsConnected: Boolean(provider.credentialsEnc),
    ...(kind === 'fanlynks' ? {
      fanlynksConnected: Boolean(provider.fanlynksTokenEnc),
      fanlynksStatus: provider.fanlynksAnalyticsStatus,
      fanlynksLastSyncedAt: provider.fanlynksLastSyncedAt,
      profileUrl: provider.profileUrl,
    } : {}),
    propertyId: typeof config.ga4PropertyId === 'string' ? config.ga4PropertyId : null,
    lastSyncedAt: provider.lastSyncedAt,
  } });
});

router.post('/models/:modelId/linkbio/:kind/analytics-connection', zValidator('json', connectionSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role') ?? '';
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!credentialRoles.has(role)) return apiError(c, 403, statusTitle(403), 'only an owner or manager can connect analytics');
  const kind = linkbioKind(c.req.param('kind'));
  if (!kind) return apiError(c, 404, statusTitle(404), 'unknown link-in-bio provider');
  if (kind === 'native') return apiError(c, 422, statusTitle(422), 'GA4 connection is available for Fanlynks, Linktree, and Beacons pages');
  const modelId = c.req.param('modelId');
  const body = c.req.valid('json');
  const provider = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const rows = await tx.select({ id: schema.linkbioProvider.id, config: schema.linkbioProvider.config })
      .from(schema.linkbioProvider).where(and(
        eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
        eq(schema.linkbioProvider.kind, kind), eq(schema.linkbioProvider.enabled, true),
      )).limit(1);
    return rows[0] ?? null;
  });
  if (!provider) return apiError(c, 404, statusTitle(404), 'enabled provider is required before connecting analytics');

  if (kind === 'fanlynks') {
    const fanlynksBody = fanlynksCredentialSchema.safeParse(body);
    if (fanlynksBody.success) {
    const origin = fanlynksOrigin(fanlynksBody.data.profileUrl);
    if (!origin) return apiError(c, 422, statusTitle(422), 'FanLynks profile URL must use HTTPS and cannot contain embedded credentials');
    let envelope;
    try {
      envelope = await encryptOAuthCredentials({ accessToken: fanlynksBody.data.apiToken });
    } catch {
      return apiError(c, 503, statusTitle(503), 'credential encryption service is unavailable');
    }
    const updated = await withOrgContext(orgId, async (tx) => {
      const rows = await tx.update(schema.linkbioProvider).set({
        profileUrl: fanlynksBody.data.profileUrl,
        fanlynksTokenEnc: envelope.encToken,
        fanlynksTokenNonce: envelope.encNonce,
        fanlynksTokenDekId: envelope.dekId,
        fanlynksAnalyticsStatus: 'configured',
        updatedAt: new Date(),
      }).where(and(
        eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
        eq(schema.linkbioProvider.kind, kind), eq(schema.linkbioProvider.enabled, true),
      )).returning({ id: schema.linkbioProvider.id });
      if (rows.length > 0) await writeAudit(tx, orgId, userId, 'linkbio.analytics.connect', modelId, {
        kind, profileOrigin: origin, tokenPrefix: 'flx_axm_',
      });
      return rows.length > 0;
    });
    if (!updated) return apiError(c, 409, statusTitle(409), 'provider changed while connecting analytics');
    return c.json({ data: { kind, fanlynksConnected: true, fanlynksStatus: 'configured', profileUrl: fanlynksBody.data.profileUrl } });
    }
  }

  const ga4Body = credentialSchema.safeParse(body);
  if (!ga4Body.success) return apiError(c, 422, statusTitle(422), 'Google Analytics service-account credentials are required');

  let envelope;
  try {
    envelope = await encryptOAuthCredentials({
      accessToken: 'google-analytics-service-account',
      extra: { clientEmail: ga4Body.data.clientEmail, privateKey: ga4Body.data.privateKey },
    });
  } catch {
    return apiError(c, 503, statusTitle(503), 'credential encryption service is unavailable');
  }
  const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
    ? provider.config as Record<string, unknown> : {};
  const nextConfig = {
    ...config,
    ga4PropertyId: ga4Body.data.propertyId,
    ga4ClickEventName: ga4Body.data.clickEventName,
    ga4ConversionEventNames: ga4Body.data.conversionEventNames,
  };
  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx.update(schema.linkbioProvider).set({
      config: nextConfig,
      credentialsEnc: envelope.encToken,
      credentialsNonce: envelope.encNonce,
      credentialsDekId: envelope.dekId,
      status: 'configured',
      updatedAt: new Date(),
    }).where(and(
      eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
      eq(schema.linkbioProvider.kind, kind), eq(schema.linkbioProvider.enabled, true),
    )).returning({ id: schema.linkbioProvider.id });
    if (rows.length > 0) await writeAudit(tx, orgId, userId, 'linkbio.analytics.connect', modelId, { kind, propertyId: ga4Body.data.propertyId });
    return rows.length > 0;
  });
  if (!updated) return apiError(c, 409, statusTitle(409), 'provider changed while connecting analytics');
  return c.json({ data: { kind, analyticsConnected: true, status: 'configured', propertyId: ga4Body.data.propertyId } });
});

router.delete('/models/:modelId/linkbio/:kind/analytics-connection', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role') ?? '';
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!credentialRoles.has(role)) return apiError(c, 403, statusTitle(403), 'only an owner or manager can revoke analytics access');
  const kind = linkbioKind(c.req.param('kind'));
  if (!kind) return apiError(c, 404, statusTitle(404), 'unknown link-in-bio provider');
  if (kind === 'native') return apiError(c, 422, statusTitle(422), 'GA4 connection is available for Fanlynks, Linktree, and Beacons pages');
  const modelId = c.req.param('modelId');
  const updated = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return false;
    const rows = await tx.select({ id: schema.linkbioProvider.id, config: schema.linkbioProvider.config })
      .from(schema.linkbioProvider).where(and(
        eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
        eq(schema.linkbioProvider.kind, kind),
      )).limit(1);
    const provider = rows[0];
    if (!provider) return false;
    if (kind === 'fanlynks' && c.req.query('source') === 'fanlynks') {
      const removed = await tx.update(schema.linkbioProvider).set({
        fanlynksTokenEnc: null,
        fanlynksTokenNonce: null,
        fanlynksTokenDekId: null,
        fanlynksAnalyticsStatus: 'configured',
        fanlynksLastSyncedAt: null,
        updatedAt: new Date(),
      }).where(eq(schema.linkbioProvider.id, provider.id)).returning({ id: schema.linkbioProvider.id });
      if (removed.length > 0) await writeAudit(tx, orgId, userId, 'linkbio.analytics.disconnect', modelId, { kind });
      return removed.length > 0;
    }
    const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
      ? { ...(provider.config as Record<string, unknown>) } : {};
    delete config.ga4PropertyId;
    delete config.ga4ClickEventName;
    delete config.ga4ConversionEventNames;
    const removed = await tx.update(schema.linkbioProvider).set({
      config,
      credentialsEnc: null,
      credentialsNonce: null,
      credentialsDekId: null,
      status: 'configured',
      lastSyncedAt: null,
      updatedAt: new Date(),
    }).where(eq(schema.linkbioProvider.id, provider.id)).returning({ id: schema.linkbioProvider.id });
    if (removed.length > 0) await writeAudit(tx, orgId, userId, 'linkbio.analytics.disconnect', modelId, { kind });
    return removed.length > 0;
  });
  if (!updated) return apiError(c, 404, statusTitle(404), 'analytics connection not found');
  return c.json({ data: kind === 'fanlynks' && c.req.query('source') === 'fanlynks'
    ? { kind, fanlynksConnected: false }
    : { kind, analyticsConnected: false } });
});

router.post('/models/:modelId/linkbio/:kind/analytics-sync', zValidator('json', syncSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role') ?? '';
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!syncRoles.has(role)) return apiError(c, 403, statusTitle(403), 'role cannot sync link-in-bio analytics');
  const kind = linkbioKind(c.req.param('kind'));
  if (!kind) return apiError(c, 404, statusTitle(404), 'unknown link-in-bio provider');
  if (kind === 'native') return apiError(c, 422, statusTitle(422), 'GA4 connection is available for Fanlynks, Linktree, and Beacons pages');
  const modelId = c.req.param('modelId');
  const { startDate, endDate } = c.req.valid('json');
  const source = c.req.query('source');
  if (kind === 'fanlynks' && source && source !== 'fanlynks' && source !== 'ga4') {
    return apiError(c, 400, statusTitle(400), 'analytics source must be fanlynks or ga4');
  }
  if (!validSyncWindow(startDate, endDate)) return apiError(c, 422, statusTitle(422), 'analytics sync window must be past and no longer than 90 days');
  const rows = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return [];
    return tx.select().from(schema.linkbioProvider).where(and(
      eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
      eq(schema.linkbioProvider.kind, kind), eq(schema.linkbioProvider.enabled, true),
    )).limit(1);
  });
  const provider = rows[0];
  const useFanlynks = kind === 'fanlynks' && source !== 'ga4'
    && (source === 'fanlynks' || Boolean(provider?.fanlynksTokenEnc));
  if (useFanlynks && endDate >= new Date().toISOString().slice(0, 10)) {
    return apiError(c, 422, statusTitle(422), 'FanLynks analytics sync requires a completed past date');
  }
  if (useFanlynks
    ? (!provider?.fanlynksTokenEnc || !provider.fanlynksTokenNonce || !provider.fanlynksTokenDekId || !provider.profileUrl)
    : (!provider?.credentialsEnc || !provider.credentialsNonce || !provider.credentialsDekId)) {
    return apiError(c, 409, statusTitle(409), useFanlynks
      ? 'connect a FanLynks page-scoped analytics token before syncing'
      : 'connect a Google Analytics property before syncing');
  }
  const binding = await resolveEgressBinding(modelId);
  if (!binding) return apiError(c, 503, statusTitle(503), 'model egress is unavailable');
  try {
    if (useFanlynks) {
      const origin = fanlynksOrigin(provider.profileUrl ?? '');
      if (!origin) throw new Error('FanLynks profile URL is invalid');
      const credentials = await decryptOAuthCredentials({
        encToken: provider.fanlynksTokenEnc!,
        encNonce: provider.fanlynksTokenNonce!,
        dekId: provider.fanlynksTokenDekId!,
      });
      const token = credentials.accessToken;
      if (typeof token !== 'string' || !/^flx_axm_[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new Error('Stored FanLynks token is invalid');
      }
      const endpoint = new URL('/api/integrations/axiom/analytics', origin);
      const since = new Date(`${startDate}T00:00:00.000Z`).toISOString();
      const until = new Date(`${endDate}T00:00:00.000Z`);
      until.setUTCDate(until.getUTCDate() + 1);
      endpoint.searchParams.set('since', since);
      endpoint.searchParams.set('until', until.toISOString());
      const response = await buildEgressFetch(binding)(endpoint, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`FanLynks analytics returned HTTP ${response.status}`);
      const payload = await readBoundedResponseJson<unknown>(response, 30_000);
      const metrics = fanlynksMetricsFromResponse(payload, startDate, endDate);
      await withOrgContext(orgId, async (tx) => {
        for (const metric of metrics) {
          await tx.insert(schema.linkbioAnalytics).values({
            orgId,
            providerId: provider.id,
            ts: metric.ts,
            kind: 'external.metrics',
            source: metric.source,
            utmSource: metric.utmSource,
            target: metric.target,
            externalEventId: metric.externalEventId,
            visits: metric.visits,
            uniqueVisitors: metric.uniqueVisitors,
            clicks: metric.clicks,
            conversions: metric.conversions,
            createdAt: new Date(),
          }).onConflictDoUpdate({
            target: [schema.linkbioAnalytics.providerId, schema.linkbioAnalytics.externalEventId],
            set: {
              source: metric.source, utmSource: metric.utmSource, target: metric.target, ts: metric.ts,
              visits: metric.visits, uniqueVisitors: metric.uniqueVisitors,
              clicks: metric.clicks, conversions: metric.conversions,
            },
          });
        }
        await tx.update(schema.linkbioProvider).set({
          fanlynksAnalyticsStatus: 'connected', fanlynksLastSyncedAt: new Date(), updatedAt: new Date(),
        })
          .where(eq(schema.linkbioProvider.id, provider.id));
        await writeAudit(tx, orgId, userId, 'linkbio.analytics.sync', modelId, {
          kind, rows: metrics.length, startDate, endDate,
          metricCoverage: { pageViews: true, clicks: true, uniqueVisitors: false, conversions: false },
        });
      });
      return c.json({ data: {
        kind, importedRows: metrics.length, startDate, endDate,
        metricCoverage: { pageViews: true, clicks: true, uniqueVisitors: false, conversions: false },
      } });
    }

    const credentials = await decryptOAuthCredentials({
      encToken: provider.credentialsEnc,
      encNonce: provider.credentialsNonce,
      dekId: provider.credentialsDekId,
    });
    const clientEmail = credentials.extra?.clientEmail;
    const privateKey = credentials.extra?.privateKey;
    const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
      ? provider.config as Record<string, unknown> : {};
    const propertyId = typeof config.ga4PropertyId === 'string' ? config.ga4PropertyId : '';
    if (typeof clientEmail !== 'string' || typeof privateKey !== 'string' || !propertyId) {
      return apiError(c, 409, statusTitle(409), 'stored analytics connection is incomplete; reconnect it');
    }
    const clickEventName = typeof config.ga4ClickEventName === 'string' ? config.ga4ClickEventName : 'link_click';
    const conversionEventNames = Array.isArray(config.ga4ConversionEventNames)
      ? config.ga4ConversionEventNames.filter((name): name is string => typeof name === 'string') : ['purchase', 'generate_lead'];
    const metrics = await fetchGa4LinkbioMetrics({
      fetcher: buildEgressFetch(binding), propertyId, clientEmail, privateKey,
      startDate, endDate, clickEventName, conversionEventNames,
    });
    await withOrgContext(orgId, async (tx) => {
      for (const metric of metrics) {
        await tx.insert(schema.linkbioAnalytics).values({
          orgId,
          providerId: provider.id,
          ts: metric.ts,
          kind: 'external.metrics',
          source: metric.source,
          target: metric.target,
          externalEventId: metric.externalEventId,
          visits: metric.visits,
          uniqueVisitors: metric.uniqueVisitors,
          clicks: metric.clicks,
          conversions: metric.conversions,
          createdAt: new Date(),
        }).onConflictDoUpdate({
          target: [schema.linkbioAnalytics.providerId, schema.linkbioAnalytics.externalEventId],
          set: {
            source: metric.source, target: metric.target, ts: metric.ts,
            visits: metric.visits, uniqueVisitors: metric.uniqueVisitors,
            clicks: metric.clicks, conversions: metric.conversions,
          },
        });
      }
      await tx.update(schema.linkbioProvider).set({ status: 'connected', lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.linkbioProvider.id, provider.id));
      await writeAudit(tx, orgId, userId, 'linkbio.analytics.sync', modelId, { kind, rows: metrics.length, startDate, endDate });
    });
    return c.json({ data: { kind, importedRows: metrics.length, startDate, endDate } });
  } catch {
    await withOrgContext(orgId, tx => tx.update(schema.linkbioProvider)
      .set(useFanlynks ? { fanlynksAnalyticsStatus: 'sync_error', updatedAt: new Date() } : { status: 'sync_error', updatedAt: new Date() })
      .where(eq(schema.linkbioProvider.id, provider.id)));
    return apiError(c, 502, statusTitle(502), useFanlynks
      ? 'FanLynks analytics sync failed; the saved connection was not replaced'
      : 'Google Analytics sync failed; the saved connection was not replaced');
  }
});

export { router as linkbioAnalyticsRouter };
