// ─── Link-in-bio provider lifecycle + first-party tracked redirects ────────
// FanLynks can be self-hosted or externally hosted. Linktree and Beacons pages
// remain managed on their own sites; AXIOM supplies tracked redirects and analytics imports.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { sql, eq, and, desc, inArray, isNotNull } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import { LINKBIO_PROVIDER_KINDS, safeExternalProfileUrl, type LinkbioProviderKind } from '../linkbio-integrations.js';

const router = new Hono<AppBindings>();
const publicRouter = new Hono<AppBindings>();
const linkbioWriteRoles = new Set(['owner', 'manager', 'operator']);

function safeFanlynksProfileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Every public page and redirect is intentionally unauthenticated. The page
// loader may provision missing short-link rows for older provider records and
// the redirect increments click/analytics state, so protect the whole public
// surface rather than only the legacy click endpoint.
publicRouter.use('*', rateLimit({ capacity: 60, refillPerSec: 1, maxBuckets: 100_000 }));

const PROVIDER_KINDS = LINKBIO_PROVIDER_KINDS;
const UTM_KEY = /^utm_[a-z][a-z0-9_]{0,31}$/;
const MAX_UTM_VALUE_LENGTH = 120;

function linkbioKindForPublic(raw: string): LinkbioProviderKind | null {
  return PROVIDER_KINDS.includes(raw as LinkbioProviderKind) ? raw as LinkbioProviderKind : null;
}

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

const postAttributionLinkSchema = z.object({
  postTargetId: z.string().uuid(),
  targetUrl: z.string().trim().url().max(2048),
}).strict();

type PostAttributionLinkResult =
  | { error: string; status: 404 | 409 }
  | { data: {
      id: string;
      slug: string;
      targetUrl: string;
      postTargetId: string;
      utm: Record<string, string>;
      path: string;
    } };

const nativeLinkInput = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048).refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
  }, 'Links must use an http(s) URL'),
  utm: z.record(z.string().regex(UTM_KEY), z.string().max(MAX_UTM_VALUE_LENGTH).trim().min(1)).optional(),
}).passthrough();

const publicTrackingSchema = z.object({
  ga4MeasurementId: z.string().regex(/^G-[A-Z0-9]{4,20}$/).optional(),
}).strict();
const providerConfigSchema = z.object({
  links: z.array(nativeLinkInput).max(100).optional(),
  publicTracking: publicTrackingSchema.optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).passthrough();
const enableSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  // Omission toggles availability without replacing the saved page contents.
  config: providerConfigSchema.optional(),
  profileUrl: z.string().trim().url().max(2048).optional(),
  isPrimary: z.boolean().optional(),
});

type NativeLink = { label: string; url: string; utm: Record<string, string> };
type PublicNativeLink = NativeLink & { slug: string };
type AttributionLink = { id: string; utm: Record<string, string> | null };
type AttributionReportLink = { id: string; slug: string; targetUrl: string; utm: Record<string, string> | null };
type AttributionEventSummary = { shortLinkId: string | null; kind: string; amountCents: number; currency: string };

function safeConfigValue(value: unknown, key = '', depth = 0): unknown {
  if (/password|secret|token|credential|authorization|private.?key|api.?key|bearer/i.test(key)) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 2048);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeConfigValue(item, '', depth + 1));
  if (typeof value !== 'object') return undefined;
  const safe: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    if (childKey === '__proto__' || childKey === 'constructor' || childKey === 'prototype') continue;
    const child = safeConfigValue(childValue, childKey, depth + 1);
    if (child !== undefined) safe[childKey] = child;
  }
  return safe;
}

function safeProviderConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  const raw = config as Record<string, unknown>;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (['links', 'accentColor', 'publicTracking', 'ga4PropertyId', 'ga4ClickEventName', 'ga4ConversionEventNames'].includes(key)
      || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const safe = safeConfigValue(value, key);
    if (safe !== undefined) result[key] = safe;
  }
  if (Array.isArray(raw.links)) result.links = nativeLinks(raw).slice(0, 100);
  if (typeof raw.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accentColor)) {
    result.accentColor = raw.accentColor;
  }
  if (raw.publicTracking && typeof raw.publicTracking === 'object' && !Array.isArray(raw.publicTracking)) {
    const tracking = raw.publicTracking as Record<string, unknown>;
    const publicTracking: Record<string, string> = {};
    if (typeof tracking.ga4MeasurementId === 'string' && /^G-[A-Z0-9]{4,20}$/.test(tracking.ga4MeasurementId)) {
      publicTracking.ga4MeasurementId = tracking.ga4MeasurementId;
    }
    result.publicTracking = publicTracking;
  }
  for (const key of ['ga4PropertyId', 'ga4ClickEventName']) {
    if (typeof raw[key] === 'string' && raw[key].length <= 80) result[key] = raw[key];
  }
  if (Array.isArray(raw.ga4ConversionEventNames)) {
    result.ga4ConversionEventNames = raw.ga4ConversionEventNames
      .filter((value): value is string => typeof value === 'string' && value.length <= 80).slice(0, 12);
  }
  return result;
}

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

function nativeShortLinkSlug(modelId: string, link: NativeLink, index: number, kind: LinkbioProviderKind = 'native'): string {
  const digest = createHash('sha256')
    .update(kind === 'native' ? `${modelId}:${index}:${link.url}` : `${kind}:${modelId}:${index}:${link.url}`)
    .digest('hex')
    .slice(0, 16);
  return `lb-${kind === 'native' ? '' : `${kind.slice(0, 2)}-`}${modelId.replaceAll('-', '').slice(0, 8)}-${index + 1}-${digest}`;
}

function nativeShortLinkUtm(link: NativeLink, index: number, kind: LinkbioProviderKind = 'native'): Record<string, string> {
  return {
    utm_source: kind === 'native' ? 'axiom' : `axiom-${kind}`,
    utm_medium: 'linkbio',
    utm_content: kind === 'native' ? `native-${index + 1}` : `${kind}-${index + 1}`,
    ...link.utm,
  };
}

function safeTrackedDestination(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.)/.test(hostname)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || hostname === 'localhost' || hostname.endsWith('.localhost') || privateIpv4
      || hostname === '::1' || hostname.includes(':')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function syncNativeShortLinks(
  tx: any,
  orgId: string,
  modelId: string,
  links: NativeLink[],
  kind: LinkbioProviderKind = 'native',
  updateExisting = true,
): Promise<PublicNativeLink[]> {
  const publicLinks: PublicNativeLink[] = [];
  for (const [index, link] of links.entries()) {
    const slug = nativeShortLinkSlug(modelId, link, index, kind);
    const utm = nativeShortLinkUtm(link, index, kind);
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
  provider: { id: string; kind: LinkbioProviderKind; profileUrl: string | null; config: unknown };
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
  kind: LinkbioProviderKind = 'native',
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
      kind: schema.linkbioProvider.kind,
      profileUrl: schema.linkbioProvider.profileUrl,
      config: schema.linkbioProvider.config,
    })
    .from(schema.linkbioProvider)
    .where(
      and(
        eq(schema.linkbioProvider.orgId, orgId),
        eq(schema.linkbioProvider.modelId, modelId),
        eq(schema.linkbioProvider.kind, kind),
        eq(schema.linkbioProvider.enabled, true),
      ),
    )
    .limit(1);
  const provider = providers[0];
  if (!provider) return null;

  const links = await syncNativeShortLinks(tx, orgId, modelId, nativeLinks(provider.config), kind, false);

  return {
    orgId,
    model,
    provider: { ...provider, kind, profileUrl: provider.profileUrl ?? null },
    links,
  };
}

function renderNativePage(page: PublicNativePage, nonce: string): string {
  const config = safeProviderConfig(page.provider.config);
  const ga4MeasurementId = page.provider.kind === 'fanlynks'
    && typeof (config.publicTracking as Record<string, unknown> | undefined)?.ga4MeasurementId === 'string'
    ? (config.publicTracking as Record<string, string>).ga4MeasurementId
    : null;
  const accentColor = typeof config.accentColor === 'string' ? config.accentColor : '#f9fafb';
  const links =
    page.links.length > 0
      ? page.links
          .map((link) => {
            const href = page.provider.kind === 'native'
              ? `/linkbio/${encodeURIComponent(page.model.id)}/s/${encodeURIComponent(link.slug)}`
              : `/linkbio/${encodeURIComponent(page.provider.kind)}/${encodeURIComponent(page.model.id)}/s/${encodeURIComponent(link.slug)}`;
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
      .link { display: block; padding: 15px 18px; border-radius: 12px; color: #111827; background: ${accentColor}; text-decoration: none; font-weight: 650; }
      .link:hover { background: #dbeafe; } footer { margin-top: 32px; color: #94a3b8; font-size: 12px; }
      #analytics-consent { position: fixed; inset: auto 12px 12px; margin: auto; width: min(92vw, 560px); padding: 16px; border: 1px solid #475569; border-radius: 12px; background: #0f172a; color: #f8fafc; box-shadow: 0 10px 32px #0008; text-align: left; }
      #analytics-consent[hidden] { display: none; } .consent-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      .consent-actions button, .privacy-settings { border: 1px solid #64748b; border-radius: 8px; padding: 7px 10px; color: inherit; background: transparent; cursor: pointer; }
    </style>
  </head>
  <body><main>${avatar}<h1>${escapeHtml(page.model.displayName)}</h1><p class="handle">@${escapeHtml(page.model.handle)}</p>${bio}<section class="links">${links}</section><footer>Powered by FanThynks${ga4MeasurementId ? ' · <button class="privacy-settings" id="privacy-settings" type="button">Privacy settings</button>' : ''}</footer></main>${ga4MeasurementId ? `<section id="analytics-consent" role="dialog" aria-label="Analytics consent" hidden><strong>Optional analytics</strong><p>This page uses Google Analytics only if you allow it. Your choice is stored in this browser.</p><div class="consent-actions"><button id="analytics-accept" type="button">Allow analytics</button><button id="analytics-reject" type="button">Reject optional analytics</button></div></section><script nonce="${nonce}">(function(){const id='${ga4MeasurementId}';const panel=document.getElementById('analytics-consent');const choiceKey='fanlynks-analytics-consent';let initialized=false;function loadAnalytics(){if(initialized){window.gtag('consent','update',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});return}initialized=true;window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});window.gtag('js',new Date());window.gtag('config',id,{allow_google_signals:false,allow_ad_personalization_signals:false});const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);document.head.appendChild(script)}function reject(){if(initialized)window.gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'})}function show(){panel.hidden=false}document.getElementById('analytics-accept').addEventListener('click',function(){localStorage.setItem(choiceKey,'granted');panel.hidden=true;loadAnalytics()});document.getElementById('analytics-reject').addEventListener('click',function(){localStorage.setItem(choiceKey,'denied');reject();panel.hidden=true});document.getElementById('privacy-settings').addEventListener('click',function(){localStorage.removeItem(choiceKey);show()});const saved=localStorage.getItem(choiceKey);if(saved==='granted')loadAnalytics();else if(saved!=='denied')show()})()</script>` : ''}</body>
</html>`;
}

// GET /models/:id/linkbio — active providers + primary
router.get('/models/:modelId/linkbio', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        id: schema.linkbioProvider.id,
        kind: schema.linkbioProvider.kind,
        enabled: schema.linkbioProvider.enabled,
        isPrimary: schema.linkbioProvider.isPrimary,
        config: schema.linkbioProvider.config,
        profileUrl: schema.linkbioProvider.profileUrl,
        status: schema.linkbioProvider.status,
        lastSyncedAt: schema.linkbioProvider.lastSyncedAt,
        createdAt: schema.linkbioProvider.createdAt,
        updatedAt: schema.linkbioProvider.updatedAt,
      })
      .from(schema.linkbioProvider)
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          inArray(schema.linkbioProvider.kind, PROVIDER_KINDS),
        ),
      )
      .orderBy(schema.linkbioProvider.createdAt),
  );
  const safeRows = rows.map((row: {
    id: string; kind: string; enabled: boolean; isPrimary: boolean; config: unknown;
    profileUrl: string | null; status: string; lastSyncedAt: Date | null; createdAt: Date; updatedAt: Date;
  }) => {
    const config = safeProviderConfig(row.config);
    config.links = nativeLinks(row.config).map((link, index) => {
      const slug = nativeShortLinkSlug(modelId, link, index, row.kind as LinkbioProviderKind);
      const path = row.kind === 'native'
        ? `/linkbio/${encodeURIComponent(modelId)}/s/${encodeURIComponent(slug)}`
        : `/linkbio/${encodeURIComponent(row.kind)}/${encodeURIComponent(modelId)}/s/${encodeURIComponent(slug)}`;
      return { ...link, slug, path };
    });
    return { ...row, config };
  });
  return c.json({
    data: {
      providers: safeRows,
      primary: safeRows.find((r: { isPrimary?: boolean | null }) => r.isPrimary) ?? safeRows[0] ?? null,
      nativeEnabled: safeRows.some(
        (r: { kind?: string | null; enabled?: boolean | null }) => r.kind === 'native' && r.enabled,
      ),
    },
  });
});

// POST /models/:id/linkbio — enable provider {kind, config}
// GET /models/:id/linkbio/post-links — published targets and their tracked links.
router.get('/models/:modelId/linkbio/post-links', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const result = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const targets = await tx.select({
      id: schema.postTarget.id,
      platform: schema.postTarget.platform,
      publishedAt: schema.postTarget.publishedAt,
      publicationSnapshot: schema.postTarget.publicationSnapshot,
    }).from(schema.postTarget)
      .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
      .where(and(
        eq(schema.postTarget.orgId, orgId),
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.contentBundle.modelId, modelId),
        eq(schema.postTarget.state, 'published'),
        isNotNull(schema.postTarget.remoteId),
      ))
      .orderBy(desc(schema.postTarget.publishedAt), desc(schema.postTarget.id)).limit(100);
    const rows = await tx.select({
      id: schema.shortLink.id,
      slug: schema.shortLink.slug,
      targetUrl: schema.shortLink.targetUrl,
      utm: schema.shortLink.utm,
      clicks: schema.shortLink.clicks,
      createdAt: schema.shortLink.createdAt,
    }).from(schema.shortLink).where(and(
      eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, modelId),
    )).orderBy(desc(schema.shortLink.createdAt), desc(schema.shortLink.id)).limit(100);
    const publishedPostIds = new Set(targets.map((target: { id: string }) => target.id));
    const postLinks = rows.flatMap((row: { id: string; slug: string; targetUrl: string; utm: unknown; clicks: number; createdAt: Date }) => {
      const utm = row.utm && typeof row.utm === 'object' && !Array.isArray(row.utm)
        ? row.utm as Record<string, string> : {};
      const postTargetId = utm.utm_medium === 'post'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(utm.utm_content ?? '')
        && publishedPostIds.has(utm.utm_content) ? utm.utm_content : null;
      return postTargetId ? [{
        id: row.id, slug: row.slug, targetUrl: row.targetUrl, postTargetId,
        clicks: row.clicks, createdAt: row.createdAt.toISOString(),
        path: `/linkbio/${encodeURIComponent(modelId)}/s/${encodeURIComponent(row.slug)}`,
      }] : [];
    });
    return {
      publishedPosts: targets.map((target: { id: string; platform: string; publishedAt: Date | null; publicationSnapshot: unknown }) => {
        const snapshot = target.publicationSnapshot && typeof target.publicationSnapshot === 'object'
          ? target.publicationSnapshot as Record<string, unknown> : {};
        const caption = typeof snapshot.caption === 'string' ? snapshot.caption.slice(0, 160) : '';
        return { id: target.id, platform: target.platform, publishedAt: target.publishedAt?.toISOString() ?? null, caption };
      }),
      links: postLinks,
    };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: result });
});

// POST /models/:id/linkbio/post-links — create the per-post UTM short link.
router.post('/models/:modelId/linkbio/post-links', zValidator('json', postAttributionLinkSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role') ?? '';
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!linkbioWriteRoles.has(role)) return apiError(c, 403, statusTitle(403), 'role cannot create attribution links');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const destination = safeTrackedDestination(body.targetUrl);
  if (!destination) return apiError(c, 400, statusTitle(400), 'attribution destination must be a public HTTPS URL');

  const saved = await withOrgContext<PostAttributionLinkResult>(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return { error: 'model not found', status: 404 as const };
    const providers = await tx.select({ id: schema.linkbioProvider.id }).from(schema.linkbioProvider).where(and(
      eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
      eq(schema.linkbioProvider.kind, 'native'), eq(schema.linkbioProvider.enabled, true),
    )).limit(1);
    if (!providers[0]) return { error: 'enable the Native link-in-bio provider before creating tracked links', status: 409 as const };
    const targets = await tx.select({
      id: schema.postTarget.id, bundleId: schema.postTarget.bundleId, platform: schema.postTarget.platform,
    }).from(schema.postTarget).where(and(
      eq(schema.postTarget.orgId, orgId), eq(schema.postTarget.id, body.postTargetId),
      eq(schema.postTarget.state, 'published'), isNotNull(schema.postTarget.remoteId),
    )).limit(1);
    const target = targets[0];
    if (!target) return { error: 'published post not found', status: 404 as const };
    const bundles = await tx.select({ id: schema.contentBundle.id }).from(schema.contentBundle).where(and(
      eq(schema.contentBundle.orgId, orgId), eq(schema.contentBundle.id, target.bundleId),
      eq(schema.contentBundle.modelId, modelId),
    )).limit(1);
    if (!bundles[0]) return { error: 'published post not found', status: 404 as const };

    const slug = `post-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const utm = {
      utm_source: 'axiom', utm_medium: 'post', utm_campaign: target.platform,
      utm_content: target.id,
    };
    const rows = await tx.insert(schema.shortLink).values({
      orgId, modelId, slug, targetUrl: destination, utm,
    }).onConflictDoNothing({ target: [schema.shortLink.orgId, schema.shortLink.slug] }).returning({
      id: schema.shortLink.id, slug: schema.shortLink.slug, targetUrl: schema.shortLink.targetUrl,
    });
    const row = rows[0];
    if (!row) return { error: 'could not reserve a unique tracked-link slug; retry the request', status: 409 as const };
    await writeAudit(tx, orgId, userId, 'linkbio.post_link.create', row.id, {
      modelId, postTargetId: target.id, platform: target.platform,
    });
    return { data: { ...row, postTargetId: target.id, utm, path: `/linkbio/${encodeURIComponent(modelId)}/s/${encodeURIComponent(row.slug)}` } };
  });
  if ('error' in saved) return apiError(c, saved.status, statusTitle(saved.status), saved.error);
  return c.json({ data: saved.data }, 201);
});

router.post('/models/:modelId/linkbio', zValidator('json', enableSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role') ?? '';
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!linkbioWriteRoles.has(role)) return apiError(c, 403, statusTitle(403), 'role cannot configure link-in-bio providers');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const externalKind = body.kind === 'linktree' || body.kind === 'beacons';
  const profileUrl = body.profileUrl === undefined ? null
    : body.kind === 'fanlynks' ? safeFanlynksProfileUrl(body.profileUrl)
      : safeExternalProfileUrl(body.profileUrl, body.kind);
  if ((externalKind || (body.kind === 'fanlynks' && body.profileUrl !== undefined)) && !profileUrl) {
    return apiError(c, 422, statusTitle(422), 'a valid HTTPS profile URL for the selected provider is required');
  }
  if (!externalKind && body.kind !== 'fanlynks' && body.profileUrl !== undefined) {
    return apiError(c, 422, statusTitle(422), 'profileUrl is supported only for external link-in-bio providers');
  }

  const saved = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    if (body.isPrimary === true) {
      await tx.update(schema.linkbioProvider).set({ isPrimary: false, updatedAt: new Date() }).where(and(
        eq(schema.linkbioProvider.orgId, orgId), eq(schema.linkbioProvider.modelId, modelId),
      ));
    }
    const [row] = await tx
      .insert(schema.linkbioProvider)
      .values({
        orgId,
        modelId,
        kind: body.kind,
        enabled: true,
        isPrimary: body.isPrimary ?? false,
        config: body.config ?? {},
        ...(profileUrl === null ? {} : { profileUrl }),
        status: 'configured',
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
          ...(profileUrl === null ? {} : { profileUrl }),
          updatedAt: new Date(),
          ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        },
      })
      .returning({
        id: schema.linkbioProvider.id,
        kind: schema.linkbioProvider.kind,
        enabled: schema.linkbioProvider.enabled,
        isPrimary: schema.linkbioProvider.isPrimary,
        config: schema.linkbioProvider.config,
        profileUrl: schema.linkbioProvider.profileUrl,
        status: schema.linkbioProvider.status,
        createdAt: schema.linkbioProvider.createdAt,
        updatedAt: schema.linkbioProvider.updatedAt,
      });
    await syncNativeShortLinks(tx, orgId, modelId, nativeLinks(row.config), body.kind);
    await writeAudit(tx, orgId, userId, 'linkbio.enable', modelId, { kind: body.kind });
    return row;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: { ...saved, config: safeProviderConfig(saved.config) } }, 201);
});

// DELETE /models/:id/linkbio/:kind — disable provider
router.delete('/models/:modelId/linkbio/:kind', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  const role = c.get('role') ?? '';
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!linkbioWriteRoles.has(role)) return apiError(c, 403, statusTitle(403), 'role cannot disable link-in-bio providers');
  const { modelId, kind } = c.req.param();
  if (!PROVIDER_KINDS.includes(kind as (typeof PROVIDER_KINDS)[number])) {
    return apiError(c, 400, statusTitle(400), 'unknown provider kind');
  }
  const updated = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.linkbioProvider)
      .set({ enabled: false, isPrimary: false, status: 'disabled', updatedAt: new Date() })
      .where(
        and(
          eq(schema.linkbioProvider.orgId, orgId),
          eq(schema.linkbioProvider.modelId, modelId),
          eq(schema.linkbioProvider.kind, kind),
        ),
      )
      .returning({
        id: schema.linkbioProvider.id,
        kind: schema.linkbioProvider.kind,
        enabled: schema.linkbioProvider.enabled,
        isPrimary: schema.linkbioProvider.isPrimary,
        config: schema.linkbioProvider.config,
        profileUrl: schema.linkbioProvider.profileUrl,
        status: schema.linkbioProvider.status,
        createdAt: schema.linkbioProvider.createdAt,
        updatedAt: schema.linkbioProvider.updatedAt,
      });
    if (rows.length > 0) {
      await writeAudit(tx, orgId, userId, 'linkbio.disable', modelId, { kind });
    }
    return rows;
  });
  if (updated.length === 0) return apiError(c, 404, statusTitle(404), 'provider not configured');
  return c.json({ data: { ...updated[0], config: safeProviderConfig(updated[0].config) } });
});

// GET /models/:id/linkbio/analytics — normalized cross-provider analytics (F-53)
router.get('/models/:modelId/linkbio/analytics', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const data = await withOrgContext(orgId, async (tx) => {
    const providers = await tx.select({
      id: schema.linkbioProvider.id,
      kind: schema.linkbioProvider.kind,
      enabled: schema.linkbioProvider.enabled,
      isPrimary: schema.linkbioProvider.isPrimary,
      status: schema.linkbioProvider.status,
      lastSyncedAt: schema.linkbioProvider.lastSyncedAt,
      hasGa4: isNotNull(schema.linkbioProvider.credentialsEnc),
      hasFanlynksAnalytics: isNotNull(schema.linkbioProvider.fanlynksTokenEnc),
    }).from(schema.linkbioProvider).where(and(
      eq(schema.linkbioProvider.orgId, orgId),
      eq(schema.linkbioProvider.modelId, modelId),
      inArray(schema.linkbioProvider.kind, PROVIDER_KINDS),
    ));
    const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const providerIds = providers.map((provider: { id: string }) => provider.id);
    const clickRows = providerIds.length === 0 ? [] : await tx.select({
      providerId: schema.linkbioClick.providerId,
      target: schema.linkbioClick.target,
      count: sql<number>`count(*)::int`,
    }).from(schema.linkbioClick).where(and(
      eq(schema.linkbioClick.orgId, orgId),
      inArray(schema.linkbioClick.providerId, providerIds),
      sql`${schema.linkbioClick.ts} >= ${start}`,
    )).groupBy(schema.linkbioClick.providerId, schema.linkbioClick.target).orderBy(desc(sql`count(*)`));
    const metricRows = providerIds.length === 0 ? [] : await tx.select({
      providerId: schema.linkbioAnalytics.providerId,
      ts: schema.linkbioAnalytics.ts,
      target: schema.linkbioAnalytics.target,
      source: schema.linkbioAnalytics.source,
      visits: schema.linkbioAnalytics.visits,
      uniqueVisitors: schema.linkbioAnalytics.uniqueVisitors,
      clicks: schema.linkbioAnalytics.clicks,
      conversions: schema.linkbioAnalytics.conversions,
    }).from(schema.linkbioAnalytics).where(and(
      eq(schema.linkbioAnalytics.orgId, orgId),
      inArray(schema.linkbioAnalytics.providerId, providerIds),
      eq(schema.linkbioAnalytics.kind, 'external.metrics'),
      sql`${schema.linkbioAnalytics.ts} >= ${start}`,
    )).orderBy(desc(schema.linkbioAnalytics.ts)).limit(10_000);

    type Bucket = { visits: number; activeUsers: number; analyticsClicks: number; conversions: number };
    const totals = { visits: 0, activeUsers: 0, analyticsClicks: 0, conversions: 0, trackedClicks: 0 };
    const providerTotals = new Map<string, typeof totals>();
    const daily = new Map<string, Bucket>();
    const targets = new Map<string, {
      providerId: string; kind: string; target: string;
      trackedClicks: number; visits: number; analyticsClicks: number; conversions: number;
    }>();
    for (const provider of providers) providerTotals.set(provider.id, { ...totals });
    const providerKinds = new Map<string, string>(
      (providers as Array<{ id: string; kind: string }>).map((provider) => [provider.id, provider.kind]),
    );
    for (const row of clickRows as Array<{ providerId: string; target: string; count: number }>) {
      const count = Number(row.count) || 0;
      const providerTotal = providerTotals.get(row.providerId);
      if (providerTotal) providerTotal.trackedClicks += count;
      totals.trackedClicks += count;
      const key = `${row.providerId}\u0000${row.target}`;
      const target = targets.get(key) ?? {
        providerId: row.providerId, kind: providerKinds.get(row.providerId) ?? 'unknown', target: row.target,
        trackedClicks: 0, visits: 0, analyticsClicks: 0, conversions: 0,
      };
      target.trackedClicks += count;
      targets.set(key, target);
    }
    for (const row of metricRows as Array<{
      providerId: string | null; ts: Date; target: string | null; source: string | null;
      visits: number; uniqueVisitors: number; clicks: number; conversions: number;
    }>) {
      if (!row.providerId) continue;
      const visits = Number(row.visits) || 0;
      const activeUsers = Number(row.uniqueVisitors) || 0;
      const analyticsClicks = Number(row.clicks) || 0;
      const conversions = Number(row.conversions) || 0;
      const providerTotal = providerTotals.get(row.providerId);
      if (providerTotal) {
        providerTotal.visits += visits;
        providerTotal.activeUsers += activeUsers;
        providerTotal.analyticsClicks += analyticsClicks;
        providerTotal.conversions += conversions;
      }
      totals.visits += visits;
      totals.activeUsers += activeUsers;
      totals.analyticsClicks += analyticsClicks;
      totals.conversions += conversions;
      const date = new Date(row.ts).toISOString().slice(0, 10);
      const bucket = daily.get(date) ?? { visits: 0, activeUsers: 0, analyticsClicks: 0, conversions: 0 };
      bucket.visits += visits;
      bucket.activeUsers += activeUsers;
      bucket.analyticsClicks += analyticsClicks;
      bucket.conversions += conversions;
      daily.set(date, bucket);
      const targetValue = row.target ?? '(not set)';
      const key = `${row.providerId}\u0000${targetValue}`;
      const target = targets.get(key) ?? {
        providerId: row.providerId, kind: providerKinds.get(row.providerId) ?? 'unknown', target: targetValue,
        trackedClicks: 0, visits: 0, analyticsClicks: 0, conversions: 0,
      };
      target.visits += visits;
      target.analyticsClicks += analyticsClicks;
      target.conversions += conversions;
      targets.set(key, target);
    }
    const providersWithStats = (providers as Array<{
      id: string; kind: string; enabled: boolean; isPrimary: boolean; status: string; lastSyncedAt: Date | null;
      hasGa4: boolean; hasFanlynksAnalytics: boolean;
    }>).map((provider) => ({ ...provider, ...(providerTotals.get(provider.id) ?? { ...totals, trackedClicks: 0 }) }));
    const metricCoverage = {
      uniqueVisitors: providersWithStats.some((provider) => provider.hasGa4),
      conversions: providersWithStats.some((provider) => provider.hasGa4),
    };
    const publicProviders = providersWithStats.map((provider) => {
      const { hasGa4: _hasGa4, hasFanlynksAnalytics: _hasFanlynksAnalytics, ...publicProvider } = provider;
      return publicProvider;
    });
    return {
      windowDays: 90,
      windowStart: start.toISOString(),
      providers: publicProviders,
      metricCoverage,
      totals,
      totalClicks: totals.trackedClicks,
      topTargets: [...targets.values()]
        .sort((left, right) => right.trackedClicks + right.analyticsClicks - left.trackedClicks - left.analyticsClicks)
        .slice(0, 20),
      daily: [...daily.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([date, values]) => ({ date, ...values })),
      note: 'Tracked redirects and imported provider metrics are reported separately. FanLynks exports page views and clicks, not unique visitors or conversions; daily GA4 unique users are summed across days and are not range-deduplicated.',
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
    const links = await tx.select({ id: schema.shortLink.id, slug: schema.shortLink.slug, targetUrl: schema.shortLink.targetUrl, utm: schema.shortLink.utm })
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
        postTargetId: link.utm?.utm_medium === 'post'
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(link.utm.utm_content ?? '')
          ? link.utm.utm_content : null,
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
  for (const [key, value] of Object.entries(nativeShortLinkUtm(link, index, page.provider.kind))) {
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
    utmSource: nativeShortLinkUtm(link, index, page.provider.kind).utm_source,
    target: link.url,
    clicks: 1,
    ts: new Date(),
    createdAt: new Date(),
  });
  return target.toString();
}

async function recordStoredShortLinkClick(
  tx: any,
  orgId: string,
  modelId: string,
  providerId: string,
  link: { id: string; targetUrl: string; utm: Record<string, string> | null },
  source: string | null,
  referrer: string | null,
  device: string | null,
): Promise<string | null> {
  const updated = await tx.update(schema.shortLink).set({ clicks: sql`${schema.shortLink.clicks} + 1` }).where(and(
    eq(schema.shortLink.id, link.id), eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, modelId),
  )).returning({ id: schema.shortLink.id });
  if (!Array.isArray(updated) || updated.length === 0) return null;
  const target = new URL(link.targetUrl);
  for (const [key, value] of Object.entries(link.utm ?? {})) {
    if (UTM_KEY.test(key) && typeof value === 'string' && value.length > 0 && value.length <= MAX_UTM_VALUE_LENGTH) {
      target.searchParams.set(key, value);
    }
  }
  await tx.insert(schema.linkbioClick).values({
    orgId, providerId, shortLinkId: link.id, target: link.targetUrl, source, ts: new Date(),
  });
  await tx.insert(schema.linkbioAnalytics).values({
    orgId, providerId, kind: 'click', source, referrer, device,
    utmSource: link.utm?.utm_source ?? null, ts: new Date(), createdAt: new Date(),
    target: link.targetUrl, clicks: 1,
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
  const nonce = randomBytes(18).toString('base64');
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' https://www.googletagmanager.com; connect-src https://www.google-analytics.com https://analytics.google.com; base-uri 'none'; object-src 'none'`,
  );
  return c.html(renderNativePage(page, nonce));
});

publicRouter.get('/fanlynks/:modelId', async (c) => {
  const modelId = c.req.param('modelId');
  const page = await withPublicModel(modelId, (tx, orgId) =>
    loadPublicNativePage(tx, orgId, modelId, 'fanlynks'),
  );
  if (!page) return c.text('Not Found', 404);
  c.header('Cache-Control', 'no-store');
  const nonce = randomBytes(18).toString('base64');
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' https://www.googletagmanager.com; connect-src https://www.google-analytics.com https://analytics.google.com; base-uri 'none'; object-src 'none'`,
  );
  return c.html(renderNativePage(page, nonce));
});

publicRouter.get('/:modelId/s/:slug', async (c) => {
  const modelId = c.req.param('modelId');
  const slug = c.req.param('slug');
  const source = c.req.query('source')?.trim().slice(0, 120) || null;

  const destination = await withPublicModel(modelId, async (tx, orgId) => {
    const page = await loadPublicNativePage(tx, orgId, modelId);
    if (!page) return null;
    const storedLinks = await tx.select({
      id: schema.shortLink.id, targetUrl: schema.shortLink.targetUrl, utm: schema.shortLink.utm,
    }).from(schema.shortLink).where(and(
      eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, modelId), eq(schema.shortLink.slug, slug),
    )).limit(1);
    if (storedLinks[0]) {
      return recordStoredShortLinkClick(
        tx, orgId, modelId, page.provider.id, storedLinks[0], source,
        c.req.header('referer')?.slice(0, 2048) ?? null,
        c.req.header('user-agent')?.slice(0, 512) ?? null,
      );
    }
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

publicRouter.get('/:kind/:modelId/s/:slug', async (c) => {
  const kind = linkbioKindForPublic(c.req.param('kind'));
  if (!kind || kind === 'native') return c.text('Not Found', 404);
  const modelId = c.req.param('modelId');
  const slug = c.req.param('slug');
  const source = c.req.query('source')?.trim().slice(0, 120) || null;
  const destination = await withPublicModel(modelId, async (tx, orgId) => {
    const page = await loadPublicNativePage(tx, orgId, modelId, kind);
    if (!page) return null;
    const links = await tx.select({
      id: schema.shortLink.id, targetUrl: schema.shortLink.targetUrl, utm: schema.shortLink.utm,
    }).from(schema.shortLink).where(and(
      eq(schema.shortLink.orgId, orgId), eq(schema.shortLink.modelId, modelId), eq(schema.shortLink.slug, slug),
    )).limit(1);
    const link = links[0];
    if (!link || !page.links.some((candidate) => candidate.slug === slug)) return null;
    return recordStoredShortLinkClick(
      tx, orgId, modelId, page.provider.id, link, source,
      c.req.header('referer')?.slice(0, 2048) ?? null,
      c.req.header('user-agent')?.slice(0, 512) ?? null,
    );
  });
  if (!destination) return c.text('Not Found', 404);
  return c.redirect(destination, 302);
});

export { router as linkbioRouter };
export { publicRouter as publicLinkbioRouter };
