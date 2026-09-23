import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { fetchGa4LinkbioMetrics, LINKBIO_PROVIDER_KINDS, type LinkbioProviderKind } from '../linkbio-integrations.js';
import { buildEgressFetch, resolveEgressBinding } from '@axiom/llm-gateway';
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
const syncSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
}).strict();
const credentialRoles = new Set(['owner', 'manager']);
const syncRoles = new Set(['owner', 'manager', 'operator']);

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
    propertyId: typeof config.ga4PropertyId === 'string' ? config.ga4PropertyId : null,
    lastSyncedAt: provider.lastSyncedAt,
  } });
});

router.post('/models/:modelId/linkbio/:kind/analytics-connection', zValidator('json', credentialSchema), async (c) => {
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

  let envelope;
  try {
    envelope = await encryptOAuthCredentials({
      accessToken: 'google-analytics-service-account',
      extra: { clientEmail: body.clientEmail, privateKey: body.privateKey },
    });
  } catch {
    return apiError(c, 503, statusTitle(503), 'credential encryption service is unavailable');
  }
  const config = provider.config && typeof provider.config === 'object' && !Array.isArray(provider.config)
    ? provider.config as Record<string, unknown> : {};
  const nextConfig = {
    ...config,
    ga4PropertyId: body.propertyId,
    ga4ClickEventName: body.clickEventName,
    ga4ConversionEventNames: body.conversionEventNames,
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
    if (rows.length > 0) await writeAudit(tx, orgId, userId, 'linkbio.analytics.connect', modelId, { kind, propertyId: body.propertyId });
    return rows.length > 0;
  });
  if (!updated) return apiError(c, 409, statusTitle(409), 'provider changed while connecting analytics');
  return c.json({ data: { kind, analyticsConnected: true, status: 'configured', propertyId: body.propertyId } });
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
  return c.json({ data: { kind, analyticsConnected: false } });
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
  if (!validSyncWindow(startDate, endDate)) return apiError(c, 422, statusTitle(422), 'analytics sync window must be past and no longer than 90 days');
  const rows = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return [];
    return tx.select().from(schema.linkbioProvider).where(and(
      eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
      eq(schema.linkbioProvider.kind, kind), eq(schema.linkbioProvider.enabled, true),
    )).limit(1);
  });
  const provider = rows[0];
  if (!provider?.credentialsEnc || !provider.credentialsNonce || !provider.credentialsDekId) {
    return apiError(c, 409, statusTitle(409), 'connect a Google Analytics property before syncing');
  }
  const binding = await resolveEgressBinding(modelId);
  if (!binding) return apiError(c, 503, statusTitle(503), 'model egress is unavailable');
  try {
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
      .set({ status: 'sync_error', updatedAt: new Date() })
      .where(eq(schema.linkbioProvider.id, provider.id)));
    return apiError(c, 502, statusTitle(502), 'Google Analytics sync failed; the saved connection was not replaced');
  }
});

export { router as linkbioAnalyticsRouter };
