// F-89 persisted UI locale preferences.
// UI language is separate from authored/content language. User choices apply
// only to the signed-in user; organization defaults are owner-managed.

import { Hono } from 'hono';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { normalizeLocale, resolveLocale, SUPPORTED_LOCALES, type SupportedLocale } from '@axiom/core';
import { db, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { apiError, requireOrg, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';
import { z } from 'zod';

const router = new Hono<AppBindings>();

const patchSchema = z.object({
  scope: z.enum(['user', 'org']).default('user'),
  locale: z.string().trim().min(2).max(35),
}).strict();

type LocaleRow = {
  scope: 'user' | 'org';
  orgId: string;
  userId: string | null;
  locale: string;
  updatedAt: Date | string;
};

async function withLocaleContext<T>(orgId: string, userId: string, fn: (tx: any) => Promise<T> | T): Promise<T> {
  return db.transaction<T>(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    return await fn(tx);
  });
}

function rowValue(row: any): LocaleRow {
  return {
    scope: row.scope,
    orgId: row.orgId,
    userId: row.userId ?? null,
    locale: row.locale,
    updatedAt: row.updatedAt,
  };
}

function toLocale(row: LocaleRow | undefined): SupportedLocale | null {
  return row ? normalizeLocale(row.locale) ?? null : null;
}

async function readSnapshot(c: any, tx: any): Promise<{
  locale: SupportedLocale;
  source: 'user' | 'org' | 'accept-language' | 'default';
  userLocale: SupportedLocale | null;
  orgLocale: SupportedLocale | null;
  supportedLocales: readonly SupportedLocale[];
  canSetOrg: boolean;
}> {
  const orgId = requireOrg(c);
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) throw new Error('locale snapshot requires auth context');
  const rows = (await tx.select().from(schema.uiLocalePreference).where(and(
    eq(schema.uiLocalePreference.orgId, orgId),
    or(
      eq(schema.uiLocalePreference.scope, 'org'),
      and(eq(schema.uiLocalePreference.scope, 'user'), eq(schema.uiLocalePreference.userId, userId)),
    ),
  ))) as any[];
  const typed = rows.map(rowValue);
  const userLocale = toLocale(typed.find(row => row.scope === 'user'));
  const orgLocale = toLocale(typed.find(row => row.scope === 'org'));
  const resolved = resolveLocale({ userLocale, orgLocale, acceptLanguage: c.req.header('accept-language') });
  return {
    locale: resolved.locale,
    source: resolved.source,
    userLocale,
    orgLocale,
    supportedLocales: SUPPORTED_LOCALES,
    canSetOrg: c.get('role') === 'owner',
  };
}

router.get('/ui-locale', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'orgId and userId required');
  try {
    const data = await withLocaleContext(orgId, userId, tx => readSnapshot(c, tx));
    return c.json({ success: true, data });
  } catch {
    return apiError(c, 500, statusTitle(500), 'ui locale could not be loaded');
  }
});

router.patch('/ui-locale', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'orgId and userId required');
  let payload: unknown;
  try {
    payload = await readBoundedJson(c.req.raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'ui locale body too large');
    return apiError(c, 400, statusTitle(400), 'invalid ui locale body');
  }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid ui locale body');
  const locale = normalizeLocale(parsed.data.locale);
  if (!locale) return apiError(c, 422, statusTitle(422), 'unsupported ui locale');
  if (parsed.data.scope === 'org' && c.get('role') !== 'owner') {
    return apiError(c, 403, statusTitle(403), 'only an organization owner can set the organization default locale');
  }

  try {
    const data = await withLocaleContext(orgId, userId, async (tx) => {
      const scope = parsed.data.scope;
      const predicate = and(
        eq(schema.uiLocalePreference.orgId, orgId),
        eq(schema.uiLocalePreference.scope, scope),
        scope === 'user' ? eq(schema.uiLocalePreference.userId, userId) : isNull(schema.uiLocalePreference.userId),
      );
      const [existing] = await tx.select().from(schema.uiLocalePreference).where(predicate).limit(1).for('update');
      if (existing) {
        await tx.update(schema.uiLocalePreference).set({ locale, updatedAt: new Date() }).where(eq(schema.uiLocalePreference.id, existing.id));
      } else {
        await tx.insert(schema.uiLocalePreference).values({
          scope,
          orgId,
          userId: scope === 'user' ? userId : null,
          locale,
        });
      }
      await writeAudit(tx, orgId, userId, 'org.ui_locale.update', orgId, { scope, locale });
      return readSnapshot(c, tx);
    });
    return c.json({ success: true, data });
  } catch {
    return apiError(c, 500, statusTitle(500), 'ui locale could not be saved');
  }
});

export { router as uiLocaleRouter };
