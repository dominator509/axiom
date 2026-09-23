// ─── Link-in-bio — native provider CRUD + first-party analytics ────────────
// External provider adapters are not implemented yet. Keep them out of the
// production route until provisioning, OAuth, token revocation, and analytics
// ingestion exist; never represent a database label as an active integration.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { sql, eq, and, desc, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { computeRoiPercent } from '../linkbio-roi.js';
import { db, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  withOrgContext,
  modelOrgId,
  requireOrg,
  writeAudit,
  apiError,
  statusTitle,
} from './helpers.js';
import { rateLimit } from '../contract.js';

const router = new Hono<AppBindings>();
const publicRouter = new Hono<AppBindings>();

// Every Native page and redirect is intentionally unauthenticated. The page
// loader may provision missing short-link rows for older provider records and
// the redirect increments click/analytics state, so protect the whole public
// surface rather than only the legacy click endpoint.
publicRouter.use('*', rateLimit({ capacity: 60, refillPerSec: 1, maxBuckets: 100_000 }));

const PROVIDER_KINDS = ['native'] as const;
const UTM_KEY = /^utm_[a-z][a-z0-9_]{0,31}$/;
const MAX_UTM_VALUE_LENGTH = 120;

const attributionUtmSchema = z.object({
  utm_source: z.string().trim().min(1).max(MAX_UTM_VALUE_LENGTH).optional(),
  utm_medium: z.string().trim().min(1).max(MAX_UTM_VALUE_LENGTH).optional(),
  utm_campaign: z.string().trim().min(1).max(MAX_UTM_VALUE_LENGTH).optional(),
  utm_content: z.string().trim().min(1).max(MAX_UTM_VALUE_LENGTH).optional(),
  utm_term: z.string().trim().min(1).max(MAX_UTM_VALUE_LENGTH).optional(),
}).strict().default({});

const attributionEventSchema = z.object({
  eventKey: z.string().trim().min(1).max(240),
  kind: z.enum(['subscription', 'ppv_purchase', 'subscription_refund']),
  amountCents: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  occurredAt: z.string().datetime({ offset: true }),
  shortLinkId: z.string().uuid().optional(),
  utm: attributionUtmSchema,
}).strict();

const campaignCostSchema = z.object({
  eventKey: z.string().trim().min(1).max(240),
  shortLinkId: z.string().uuid(),
  amountCents: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

const nativeLinkInput = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048).refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
  }, 'Links must use an http(s) URL'),
  utm: z.record(z.string().regex(UTM_KEY), z.string().max(MAX_UTM_VALUE_LENGTH).trim().min(1)).optional(),
}).passthrough();

const enableSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  // Omission toggles availability without replacing the saved page contents.
  config: z.object({ links: z.array(nativeLinkInput).optional() }).passthrough().optional(),
  isPrimary: z.boolean().optional(),
});

type NativeLink = { label: string; url: string; utm: Record<string, string> };
type PublicNativeLink = NativeLink & { slug: string };
type AttributionLink = { id: string; utm: Record<string, string> | null };
type AttributionReportLink = { id: string; slug: string; targetUrl: string };
type AttributionEventSummary = { shortLinkId: string | null; kind: string; amountCents: number; currency: string };

function nativeLinks(config: unknown): NativeLink[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const links = (config as Record<string, unknown>).links;
  if (!Array.isArray(links)) return [];

  return links.flatMap((entry): NativeLink[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!label || label.length > 120 || !url || url.length > 2048) return [];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [];
    } catch {
      return [];
    }
    const utm =
      record.utm && typeof record.utm === 'object' && !Array.isArray(record.utm)
        ? Object.fromEntries(
            Object.entries(record.utm).flatMap(([key, value]) =>
              UTM_KEY.test(key) &&
              typeof value === 'string' &&
              value.trim().length > 0 &&
              value.length <= MAX_UTM_VALUE_LENGTH
                ? [[key, value.trim()]]
                : [],
            ),
          )
        : {};
    return [{ label, url, utm }];
  });
}

function nativeShortLinkSlug(modelId: string, link: NativeLink, index: number): string {
  const digest = createHash('sha256')
    .update(`${modelId}:${index}:${link.url}`)
    .digest('hex')
    .slice(0, 16);
  return `lb-${modelId.replaceAll('-', '').slice(0, 8)}-${index + 1}-${digest}`;
}

function nativeShortLinkUtm(link: NativeLink, index: number): Record<string, string> {
  return {
    utm_source: 'axiom',
    utm_medium: 'linkbio',
    utm_content: `native-${index + 1}`,
    ...link.utm,
  };
}

async function syncNativeShortLinks(
  tx: any,
  orgId: string,
  modelId: string,
  links: NativeLink[],
  updateExisting = true,
): Promise<PublicNativeLink[]> {
  const publicLinks: PublicNativeLink[] = [];
  for (const [index, link] of links.entries()) {
    const slug = nativeShortLinkSlug(modelId, link, index);
    const utm = nativeShortLinkUtm(link, index);
    const insert = tx.insert(schema.shortLink).values({
      orgId,
      modelId,
      slug,
      targetUrl: link.url,
      utm,
    });
    if (updateExisting) {
      await insert.onConflictDoUpdate({
        target: [schema.shortLink.orgId, schema.shortLink.slug],
        set: { targetUrl: link.url, utm },
      });
    } else {
      await insert.onConflictDoNothing({
        target: [schema.shortLink.orgId, schema.shortLink.slug],
      });
    }
    publicLinks.push({ ...link, slug });
  }
  return publicLinks;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character,
  );
}

type PublicNativePage = {
  orgId: string;
  model: {
    id: string;
    displayName: string;
    handle: string;
    avatarUrl: string | null;
    bio: string | null;
  };
  provider: { id: string; config: unknown };
  links: PublicNativeLink[];
};

/** Resolve a public model through the existing SECURITY DEFINER org resolver. */
async function withPublicModel<T>(
  modelId: string,
  fn: (tx: any, orgId: string) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`SELECT resolve_model_org(${modelId}::uuid) AS org_id`);
    const orgId = (result?.rows?.[0] as { org_id?: string } | undefined)?.org_id;
    if (!orgId) return null;
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx, orgId);
  });
}

async function loadPublicNativePage(
  tx: any,
  orgId: string,
  modelId: string,
): Promise<PublicNativePage | null> {
  const models = await tx
    .select({
      id: schema.modelProfile.id,
      displayName: schema.modelProfile.displayName,
      handle: schema.modelProfile.handle,
      avatarUrl: schema.modelProfile.avatarUrl,
      bio: schema.modelProfile.bio,
    })
    .from(schema.modelProfile)
    .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.isActive, true)))
    .limit(1);
  const model = models[0];
  if (!model) return null;

  const providers = await tx
    .select({
      id: schema.linkbioProvider.id,
      config: schema.linkbioProvider.config,
    })
    .from(schema.linkbioProvider)
    .where(
      and(
        eq(schema.linkbioProvider.orgId, orgId),
        eq(schema.linkbioProvider.modelId, modelId),
        eq(schema.linkbioProvider.kind, 'native'),
        eq(schema.linkbioProvider.enabled, true),
      ),
    )
    .limit(1);
  const provider = providers[0];
  if (!provider) return null;

  const links = await syncNativeShortLinks(tx, orgId, modelId, nativeLinks(provider.config), false);

  return {
    orgId,
    model,
    provider,
    links,
  };
}

function renderNativePage(page: PublicNativePage): string {
  const links =
    page.links.length > 0
      ? page.links
          .map((link) => {
            const href = `/linkbio/${encodeURIComponent(page.model.id)}/s/${encodeURIComponent(link.slug)}`;
            return `<a class="link" href="${href}">${escapeHtml(link.label)}</a>`;
          })
          .join('')
      : '<p class="empty">No links have been configured yet.</p>';
  const avatar = page.model.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(page.model.avatarUrl)}" alt="" />`
    : '';
  const bio = page.model.bio ? `<p class="bio">${escapeHtml(page.model.bio)}</p>` : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.model.displayName)} — links</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #f9fafb; }
      main { width: min(92vw, 480px); padding: 40px 20px; text-align: center; }
      .avatar { width: 88px; height: 88px; object-fit: cover; border-radius: 50%; margin-bottom: 16px; }
      h1 { margin: 0; font-size: 28px; } .handle, .bio, .empty { color: #cbd5e1; }
      .bio { white-space: pre-wrap; } .links { display: grid; gap: 12px; margin-top: 28px; }
      .link { display: block; padding: 15px 18px; border-radius: 12px; color: #111827; background: #f9fafb; text-decoration: none; font-weight: 650; }
      .link:hover { background: #dbeafe; } footer { margin-top: 32px; color: #94a3b8; font-size: 12px; }
    </style>
  </head>
  <body><main>${avatar}<h1>${escapeHtml(page.model.displayName)}</h1><p class="handle">@${escapeHtml(page.model.handle)}</p>${bio}<section class="links">${links}</section><footer>Powered by FanThynks</footer></main></body>
</html>`;
}

// GET /models/:id/linkbio — active providers + primary
router.get('/models/:modelId/linkbio', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.linkbioProvider)
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, 'native'),
        ),
      )
      .orderBy(schema.linkbioProvider.createdAt),
  );
  return c.json({
    data: {
      providers: rows,
      primary: rows.find((r: { isPrimary?: boolean | null }) => r.isPrimary) ?? rows[0] ?? null,
      nativeEnabled: rows.some(
        (r: { kind?: string | null; enabled?: boolean | null }) => r.kind === 'native' && r.enabled,
      ),
    },
  });
});

// POST /models/:id/linkbio — enable provider {kind, config}
router.post('/models/:modelId/linkbio', zValidator('json', enableSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const saved = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const [row] = await tx
      .insert(schema.linkbioProvider)
      .values({
        orgId,
        modelId,
        kind: body.kind,
        enabled: true,
        isPrimary: body.isPrimary ?? false,
        config: body.config ?? {},
      })
      .onConflictDoUpdate({
        target: [
          schema.linkbioProvider.orgId,
          schema.linkbioProvider.modelId,
          schema.linkbioProvider.kind,
        ],
        set: {
          enabled: true,
          ...(body.config === undefined ? {} : { config: body.config }),
          updatedAt: new Date(),
          ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        },
      })
      .returning();
    await syncNativeShortLinks(tx, orgId, modelId, nativeLinks(row.config));
    await writeAudit(tx, orgId, userId, 'linkbio.enable', modelId, { kind: body.kind });
    return row;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: saved }, 201);
});

// DELETE /models/:id/linkbio/:kind — disable provider
router.delete('/models/:modelId/linkbio/:kind', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, kind } = c.req.param();
  if (!PROVIDER_KINDS.includes(kind as (typeof PROVIDER_KINDS)[number])) {
    return apiError(c, 400, statusTitle(400), 'unknown provider kind');
  }
  const userId = c.get('userId') ?? 'system';

  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.linkbioProvider)
      .set({ enabled: false, isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, kind),
        ),
      )
      .returning();
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'linkbio.disable', modelId, { kind });
    }
    return rows;
  });
  if (updated.length === 0) return apiError(c, 404, statusTitle(404), 'provider not enabled');
  return c.json({ data: updated[0] });
});

// GET /models/:id/linkbio/analytics — normalized cross-provider analytics (F-53)
router.get('/models/:modelId/linkbio/analytics', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const data = await withOrgContext(orgId, async (tx) => {
    const providers = await tx
      .select()
      .from(schema.linkbioProvider)
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, 'native'),
        ),
      );

    const providerIds = providers.map((p: { id: string }) => p.id);
    let clicks: Array<{ providerId: string; target: string; count: number }> = [];
    if (providerIds.length > 0) {
      clicks = await tx
        .select({
          providerId: schema.linkbioClick.providerId,
          target: schema.linkbioClick.target,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.linkbioClick)
        .where(
          sql`${schema.linkbioClick.providerId} IN (${providerIds.map((id: string) => sql`${id}`).join(', ')})`,
        )
        .groupBy(schema.linkbioClick.providerId, schema.linkbioClick.target)
        .orderBy(desc(sql`count(*)`));
    }

    const total = clicks.reduce((acc, c) => acc + c.count, 0);
    return {
      providers: providers.map(
        (p: { id: string; kind: string; enabled: boolean; isPrimary?: boolean | null }) => ({
          id: p.id,
          kind: p.kind,
          enabled: p.enabled,
          isPrimary: p.isPrimary,
          clicks: clicks.filter((c) => c.providerId === p.id).reduce((acc, c) => acc + c.count, 0),
        }),
      ),
      totalClicks: total,
      topTargets: clicks.slice(0, 10),
    };
  });
  return c.json({ data });
});

// POST /models/:id/linkbio/attribution-events — ingest one authoritative,
// idempotent Fanvue subscription/PPV fact. This is an ingestion seam for the
// connector/MCP path; it never calls a provider and never stores raw payloads.
router.post(
  '/models/:modelId/linkbio/attribution-events',
  zValidator('json', attributionEventSchema),
  async (c) => {
    const orgId = requireOrg(c);
    const userId = c.get('userId');
    if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
    const modelId = c.req.param('modelId');
    const body = c.req.valid('json');

    const result = await withOrgContext(orgId, async (tx) => {
      const models = await tx.select({ id: schema.modelProfile.id })
        .from(schema.modelProfile)
        .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId)))
        .limit(1);
      if (models.length === 0) return { status: 404 as const, error: 'model not found' };

      const links = await tx.select({ id: schema.shortLink.id, utm: schema.shortLink.utm })
        .from(schema.shortLink)
        .where(and(eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, modelId)))
        .limit(1001) as AttributionLink[];
      if (links.length > 1000) return { status: 409 as const, error: 'too many model short links to resolve attribution safely' };

      let shortLinkId: string | null = null;
      if (body.shortLinkId) {
        if (!links.some((link) => link.id === body.shortLinkId)) {
          return { status: 404 as const, error: 'short link is not assigned to this model' };
        }
        shortLinkId = body.shortLinkId;
      } else {
        const matching = links.filter((link) => {
          const saved = (link.utm ?? {}) as Record<string, string>;
          return Object.entries(body.utm).every(([key, value]) => saved[key] === value);
        });
        if (matching.length > 1) return { status: 409 as const, error: 'attribution UTM context matches multiple short links' };
        if (matching.length === 1) shortLinkId = matching[0].id;
      }

      const values = {
        orgId,
        modelId,
        shortLinkId,
        source: 'fanvue' as const,
        eventKey: body.eventKey,
        kind: body.kind,
        amountCents: body.amountCents,
        currency: body.currency,
        utm: body.utm,
        occurredAt: new Date(body.occurredAt),
      };
      const inserted = await tx.insert(schema.linkbioAttributionEvent).values(values)
        .onConflictDoNothing({
          target: [schema.linkbioAttributionEvent.orgId, schema.linkbioAttributionEvent.source, schema.linkbioAttributionEvent.eventKey],
        })
        .returning();
      if (inserted.length > 0) {
        await writeAudit(tx, orgId, userId, 'linkbio.attribution.ingest', modelId, {
          source: 'fanvue', kind: body.kind, attributed: Boolean(shortLinkId),
        });
        return { status: 201 as const, data: inserted[0], duplicate: false };
      }

      const existing = await tx.select().from(schema.linkbioAttributionEvent).where(and(
        eq(schema.linkbioAttributionEvent.orgId, orgId),
        eq(schema.linkbioAttributionEvent.source, 'fanvue'),
        eq(schema.linkbioAttributionEvent.eventKey, body.eventKey),
      )).limit(1);
      if (existing.length === 0) return { status: 409 as const, error: 'attribution event could not be reconciled' };
      const prior = existing[0];
      if (prior.modelId !== modelId || prior.kind !== body.kind || prior.amountCents !== body.amountCents || prior.currency !== body.currency) {
        return { status: 409 as const, error: 'event key is already bound to a different attribution event' };
      }
      return { status: 200 as const, data: prior, duplicate: true };
    });

    if ('error' in result) return apiError(c, result.status, statusTitle(result.status), result.error ?? 'attribution event rejected');
    return c.json({ data: result.data, duplicate: result.duplicate }, result.status);
  },
);

// POST /models/:id/linkbio/campaign-costs — record real operator-supplied spend.
router.post('/models/:modelId/linkbio/campaign-costs', zValidator('json', campaignCostSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  const modelId = c.req.param('modelId');
  const body = c.req.valid('json');
  const result = await withOrgContext(orgId, async (tx) => {
    const models = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(
      eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId),
    )).limit(1);
    if (models.length === 0) return { status: 404 as const, error: 'model not found' };
    const links = await tx.select({ id: schema.shortLink.id }).from(schema.shortLink).where(and(
      eq(schema.shortLink.id, body.shortLinkId),
      eq(schema.shortLink.orgId, orgId),
      eq(schema.shortLink.modelId, modelId),
    )).limit(1);
    if (links.length === 0) return { status: 404 as const, error: 'short link is not assigned to this model' };
    const occurredAt = new Date(body.occurredAt);
    const values = {
      orgId, modelId, shortLinkId: body.shortLinkId, eventKey: body.eventKey,
      amountCents: body.amountCents, currency: body.currency, occurredAt, recordedByUserId: userId,
    };
    const inserted = await tx.insert(schema.linkbioCampaignCost).values(values).onConflictDoNothing({
      target: [schema.linkbioCampaignCost.orgId, schema.linkbioCampaignCost.eventKey],
    }).returning();
    if (inserted.length > 0) {
      await writeAudit(tx, orgId, userId, 'linkbio.campaign_cost.record', body.shortLinkId, {
        modelId, amountCents: body.amountCents, currency: body.currency,
      });
      return { status: 201 as const, data: inserted[0], duplicate: false };
    }
    const existing = await tx.select().from(schema.linkbioCampaignCost).where(and(
      eq(schema.linkbioCampaignCost.orgId, orgId), eq(schema.linkbioCampaignCost.eventKey, body.eventKey),
    )).limit(1);
    const prior = existing[0];
    if (!prior) return { status: 409 as const, error: 'campaign cost could not be reconciled' };
    if (prior.modelId !== modelId || prior.shortLinkId !== body.shortLinkId || prior.amountCents !== body.amountCents
      || prior.currency !== body.currency || prior.occurredAt.getTime() !== occurredAt.getTime()) {
      return { status: 409 as const, error: 'event key is already bound to a different campaign cost' };
    }
    return { status: 200 as const, data: prior, duplicate: true };
  });
  if ('error' in result) return apiError(c, result.status, statusTitle(result.status), result.error ?? 'campaign cost rejected');
  return c.json({ data: result.data, duplicate: result.duplicate }, result.status);
});

// GET /models/:id/linkbio/attribution — bounded first-party revenue join.
router.get('/models/:modelId/linkbio/attribution', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');

  const data = await withOrgContext(orgId, async (tx) => {
    const models = await tx.select({ id: schema.modelProfile.id })
      .from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId)))
      .limit(1);
    if (models.length === 0) return null;
    const links = await tx.select({ id: schema.shortLink.id, slug: schema.shortLink.slug, targetUrl: schema.shortLink.targetUrl })
      .from(schema.shortLink)
      .where(and(eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, modelId)))
      .limit(1001) as AttributionReportLink[];
    if (links.length > 1000) return null;
    const shortLinkIds = links.map((link) => link.id);
    const clicks: Array<{ shortLinkId: string | null }> = shortLinkIds.length === 0 ? [] : await tx.select({ shortLinkId: schema.linkbioClick.shortLinkId })
      .from(schema.linkbioClick)
      .where(and(eq(schema.linkbioClick.orgId, orgId), inArray(schema.linkbioClick.shortLinkId, shortLinkIds)));
    const events = await tx.select({
      shortLinkId: schema.linkbioAttributionEvent.shortLinkId,
      kind: schema.linkbioAttributionEvent.kind,
      amountCents: schema.linkbioAttributionEvent.amountCents,
      currency: schema.linkbioAttributionEvent.currency,
    }).from(schema.linkbioAttributionEvent).where(and(
      eq(schema.linkbioAttributionEvent.orgId, orgId),
      eq(schema.linkbioAttributionEvent.modelId, modelId),
    )) as AttributionEventSummary[];
    const costs = await tx.select({
      shortLinkId: schema.linkbioCampaignCost.shortLinkId,
      amountCents: schema.linkbioCampaignCost.amountCents,
      currency: schema.linkbioCampaignCost.currency,
    }).from(schema.linkbioCampaignCost).where(and(
      eq(schema.linkbioCampaignCost.orgId, orgId),
      eq(schema.linkbioCampaignCost.modelId, modelId),
    ));
    const clicksByLink = new Map<string, number>();
    for (const click of clicks) if (click.shortLinkId) clicksByLink.set(click.shortLinkId, (clicksByLink.get(click.shortLinkId) ?? 0) + 1);
    const eventsByLink = new Map<string, { conversions: number; revenueByCurrency: Record<string, number> }>();
    let unattributedConversions = 0;
    const unattributedRevenueByCurrency: Record<string, number> = {};
    for (const event of events) {
      const signedAmount = event.kind === 'subscription_refund' ? -event.amountCents : event.amountCents;
      if (!event.shortLinkId) {
        unattributedConversions += 1;
        unattributedRevenueByCurrency[event.currency] = (unattributedRevenueByCurrency[event.currency] ?? 0) + signedAmount;
        continue;
      }
      const current = eventsByLink.get(event.shortLinkId) ?? { conversions: 0, revenueByCurrency: {} };
      current.conversions += 1;
      current.revenueByCurrency[event.currency] = (current.revenueByCurrency[event.currency] ?? 0) + signedAmount;
      eventsByLink.set(event.shortLinkId, current);
    }
    const costsByLink = new Map<string, Record<string, number>>();
    for (const cost of costs) {
      const current = costsByLink.get(cost.shortLinkId) ?? {};
      current[cost.currency] = (current[cost.currency] ?? 0) + cost.amountCents;
      costsByLink.set(cost.shortLinkId, current);
    }
    const rows = links.map((link) => {
      const event = eventsByLink.get(link.id) ?? { conversions: 0, revenueByCurrency: {} };
      const costByCurrency = costsByLink.get(link.id) ?? {};
      const currencies = [...new Set([...Object.keys(event.revenueByCurrency), ...Object.keys(costByCurrency)])];
      const roiByCurrency = Object.fromEntries(currencies.map((currency) => [
        currency,
        computeRoiPercent(event.revenueByCurrency[currency] ?? 0, costByCurrency[currency] ?? 0) ?? null,
      ]));
      return {
        ...link,
        clicks: clicksByLink.get(link.id) ?? 0,
        conversions: event.conversions,
        revenueCents: event.revenueByCurrency.USD ?? 0,
        costCents: costByCurrency.USD ?? 0,
        roiPercent: roiByCurrency.USD ?? null,
        revenueByCurrency: event.revenueByCurrency,
        costByCurrency,
        roiByCurrency,
      };
    });
    const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const attributedConversions = rows.reduce((sum, row) => sum + row.conversions, 0);
    const attributedRevenueByCurrency: Record<string, number> = {};
    const campaignCostByCurrency: Record<string, number> = {};
    for (const row of rows) {
      for (const [currency, amount] of Object.entries(row.revenueByCurrency)) {
        attributedRevenueByCurrency[currency] = (attributedRevenueByCurrency[currency] ?? 0) + amount;
      }
      for (const [currency, amount] of Object.entries(row.costByCurrency)) {
        campaignCostByCurrency[currency] = (campaignCostByCurrency[currency] ?? 0) + amount;
      }
    }
    const currencies = [...new Set([...Object.keys(attributedRevenueByCurrency), ...Object.keys(campaignCostByCurrency)])];
    const roiByCurrency = Object.fromEntries(currencies.map((currency) => [
      currency,
      computeRoiPercent(attributedRevenueByCurrency[currency] ?? 0, campaignCostByCurrency[currency] ?? 0) ?? null,
    ]));
    const hasSpend = Object.values(campaignCostByCurrency).some((amount) => amount > 0);
    return {
      currency: currencies.length === 1 ? currencies[0] : null,
      totalClicks, attributedConversions, unattributedConversions,
      attributedRevenueCents: attributedRevenueByCurrency.USD ?? 0,
      attributedRevenueByCurrency, unattributedRevenueByCurrency, campaignCostByCurrency, roiByCurrency,
      conversionRate: totalClicks > 0 ? attributedConversions / totalClicks : 0,
      roi: roiByCurrency.USD ?? null,
      roiStatus: hasSpend ? 'available_by_currency' : 'unavailable_without_campaign_costs',
      links: rows,
    };
  });
  if (!data) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data });
});

// POST /linkbio/clicks — record a click (used by the served native page)
router.post(
  '/linkbio/clicks',
  zValidator(
    'json',
    z.object({
      providerId: z.string().uuid(),
      target: z.string().min(1).max(2048),
      source: z.string().max(120).optional(),
    }),
  ),
  async (c) => {
    const orgId = requireOrg(c);
    if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
    const body = c.req.valid('json');

    const recorded = await withOrgContext(orgId, async (tx) => {
      const providers = await tx
        .select({
          id: schema.linkbioProvider.id,
          kind: schema.linkbioProvider.kind,
          config: schema.linkbioProvider.config,
        })
        .from(schema.linkbioProvider)
        .where(
          and(
            eq(schema.linkbioProvider.id, body.providerId),
            eq(schema.linkbioProvider.orgId, orgId),
            eq(schema.linkbioProvider.kind, 'native'),
            eq(schema.linkbioProvider.enabled, true),
          ),
        )
        .limit(1);
      if (providers.length === 0) return { ok: false as const, reason: 'provider' as const };
      const provider = providers[0];
      if (provider.kind !== 'native') return { ok: false as const, reason: 'provider' as const };
      if (!nativeLinks(provider.config).some((link) => link.url === body.target)) {
        return { ok: false as const, reason: 'target' as const };
      }
      await tx.insert(schema.linkbioClick).values({
        orgId,
        providerId: body.providerId,
        target: body.target,
        source: body.source ?? null,
        ts: new Date(),
      });
      return { ok: true as const };
    });
    if (!recorded.ok) {
      return recorded.reason === 'target'
        ? apiError(c, 400, statusTitle(400), 'target is not configured for this provider')
        : apiError(c, 404, statusTitle(404), 'provider not enabled');
    }
    return c.json({ success: true });
  },
);

async function recordNativeShortLinkClick(
  tx: any,
  orgId: string,
  modelId: string,
  page: PublicNativePage,
  link: PublicNativeLink,
  source: string | null,
  referrer: string | null,
  device: string | null,
): Promise<string | null> {
  const index = page.links.indexOf(link);
  const updated = await tx
    .update(schema.shortLink)
    .set({ clicks: sql`${schema.shortLink.clicks} + 1` })
    .where(
      and(
        eq(schema.shortLink.orgId, orgId),
        eq(schema.shortLink.modelId, modelId),
        eq(schema.shortLink.slug, link.slug),
      ),
    )
    .returning({ id: schema.shortLink.id });
  if (!Array.isArray(updated) || updated.length === 0) return null;

  const target = new URL(link.url);
  for (const [key, value] of Object.entries(nativeShortLinkUtm(link, index))) {
    target.searchParams.set(key, value);
  }
  await tx.insert(schema.linkbioClick).values({
    orgId,
    providerId: page.provider.id,
    shortLinkId: updated[0].id,
    target: link.url,
    source,
    ts: new Date(),
  });
  await tx.insert(schema.linkbioAnalytics).values({
    orgId,
    providerId: page.provider.id,
    kind: 'click',
    source,
    referrer,
    device,
    utmSource: nativeShortLinkUtm(link, index).utm_source,
    ts: new Date(),
    createdAt: new Date(),
  });
  return target.toString();
}

// ── Public Native provider ─────────────────────────────────────────────────
// The dashboard owns provider configuration, but visitors must not need an
// operator session to view the page or record a click. The model→org lookup
// uses the existing SECURITY DEFINER resolver, then every domain query runs
// under FORCE-RLS context.
publicRouter.get('/:modelId', async (c) => {
  const modelId = c.req.param('modelId');
  const page = await withPublicModel(modelId, (tx, orgId) =>
    loadPublicNativePage(tx, orgId, modelId),
  );
  if (!page) return c.text('Not Found', 404);
  c.header('Cache-Control', 'no-store');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'",
  );
  return c.html(renderNativePage(page));
});

publicRouter.get('/:modelId/s/:slug', async (c) => {
  const modelId = c.req.param('modelId');
  const slug = c.req.param('slug');
  const source = c.req.query('source')?.trim().slice(0, 120) || null;

  const destination = await withPublicModel(modelId, async (tx, orgId) => {
    const page = await loadPublicNativePage(tx, orgId, modelId);
    if (!page) return null;
    const link = page.links.find((candidate) => candidate.slug === slug);
    if (!link) return null;
    return recordNativeShortLinkClick(
      tx,
      orgId,
      modelId,
      page,
      link,
      source,
      c.req.header('referer')?.slice(0, 2048) ?? null,
      c.req.header('user-agent')?.slice(0, 512) ?? null,
    );
  });

  if (!destination) return c.text('Not Found', 404);
  return c.redirect(destination, 302);
});

export { router as linkbioRouter };
export { publicRouter as publicLinkbioRouter };
