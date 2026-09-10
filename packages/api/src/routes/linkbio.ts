// ─── Link-in-bio — native provider CRUD + first-party analytics ────────────
// External provider adapters are not implemented yet. Keep them out of the
// production route until provisioning, OAuth, token revocation, and analytics
// ingestion exist; never represent a database label as an active integration.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { createHash } from 'node:crypto';
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

// Public click telemetry is intentionally unauthenticated, so it needs its
// own anonymous bucket rather than relying on the authenticated /api/v1 gate.
publicRouter.use(
  '/:modelId/click/:providerId',
  rateLimit({ capacity: 60, refillPerSec: 1, maxBuckets: 100_000 }),
);

const PROVIDER_KINDS = ['native'] as const;

const enableSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  config: z.record(z.string(), z.unknown()).default({}),
  isPrimary: z.boolean().optional(),
});

type NativeLink = { label: string; url: string; utm: Record<string, string> };
type PublicNativeLink = NativeLink & { slug: string };

const UTM_KEY = /^utm_[a-z][a-z0-9_]{0,31}$/;
const MAX_UTM_VALUE_LENGTH = 120;

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
  <body><main>${avatar}<h1>${escapeHtml(page.model.displayName)}</h1><p class="handle">@${escapeHtml(page.model.handle)}</p>${bio}<section class="links">${links}</section><footer>Powered by AXIOM</footer></main></body>
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
        config: body.config,
      })
      .onConflictDoUpdate({
        target: [
          schema.linkbioProvider.orgId,
          schema.linkbioProvider.modelId,
          schema.linkbioProvider.kind,
        ],
        set: {
          enabled: true,
          config: body.config,
          updatedAt: new Date(),
          ...(body.isPrimary === undefined ? {} : { isPrimary: body.isPrimary }),
        },
      })
      .returning();
    await syncNativeShortLinks(tx, orgId, modelId, nativeLinks(body.config));
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
