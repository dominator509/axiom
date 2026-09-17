import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { schema } from '@axiom/db';
import type { AppBindings } from './index.js';
import { apiError, statusTitle, withOrgContext } from './routes/helpers.js';

export type ScopedHumanRole = 'chatter' | 'content_creator' | 'model';
export function isScopedHumanRole(role: unknown): role is ScopedHumanRole {
  return role === 'chatter' || role === 'content_creator' || role === 'model';
}

/** Correlate to the resource's model column; apply inside its tenant query before pagination. */
export function modelAccessCondition(role: unknown, orgId: string, userId: string | undefined, modelColumn: SQLWrapper = schema.modelProfile.id): SQL | undefined {
  if (!isScopedHumanRole(role)) return undefined;
  if (!userId || !orgId) return sql`false`;
  const assignment = sql`EXISTS (
    SELECT 1 FROM model_user_assignment mua
    WHERE mua.org_id = ${orgId} AND mua.model_id = ${modelColumn}
      AND mua.user_id = ${userId}
  )`;
  if (role !== 'chatter') return assignment;
  // Database time, half-open interval, exact tenant/model/user. A queue label
  // alone is not permission; an assignment and a currently active shift coexist.
  return and(assignment, sql`EXISTS (
    SELECT 1 FROM team_shift ts
    WHERE ts.org_id = ${orgId} AND ts.model_id = ${modelColumn}
      AND ts.assignee_user_id = ${userId} AND ts.status = 'active'
      AND ts.starts_at <= statement_timestamp() AND ts.ends_at > statement_timestamp()
  )`)!;
}

/** Explicit role allowlist. Unimplemented operations stay denied. */
export function scopedReadTarget(role: ScopedHumanRole, method: string, path: string): 'discovery' | string | null {
  const replies = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/inbox\/replies$/i.exec(path);
  if (replies && ((role === 'chatter' && ['GET', 'HEAD', 'POST'].includes(method))
    || (role === 'model' && ['GET', 'HEAD'].includes(method)))) return replies[1];
  if (role === 'chatter' && ['GET', 'HEAD'].includes(method) && path === '/api/v1/my-shifts') return 'self-shifts';
  if (role === 'content_creator') {
    // Own-user credential lifecycle only. Gateway derives identity from the
    // authenticated context, never a model, request body or supplied user ID.
    const grok = '/api/v1/llm/subscriptions/grok';
    if (path === grok && ['GET', 'HEAD', 'DELETE'].includes(method)) return 'self-subscription';
    if (path === `${grok}/login-attempt` && ['GET', 'HEAD', 'POST'].includes(method)) return 'self-subscription';
    const notes = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team-notes$/i.exec(path);
    if (notes && ['GET', 'HEAD', 'POST'].includes(method)) return notes[1];
    const score = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/playbook-score$/i.exec(path);
    if (score && ['GET', 'HEAD'].includes(method)) return score[1];
    if (/^\/api\/v1\/llm\/subscriptions\/grok\/login-attempt\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
      && ['GET', 'HEAD', 'DELETE'].includes(method)) return 'self-subscription';
    // The existing bounded JSON validator owns parsing. Its bundle handler
    // checks the body model's assignment inside the creation transaction.
    if (method === 'POST' && path === '/api/v1/bundles') return 'bundle-create';
    const preparation = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(generate|media-upload|media-operations|media-source-images|playbook-guidelines)$/i.exec(path);
    if (preparation && ((method === 'POST' && ['generate', 'media-upload', 'media-operations'].includes(preparation[2]))
      || ((method === 'GET' || method === 'HEAD') && ['media-operations', 'media-source-images', 'playbook-guidelines'].includes(preparation[2])))) return preparation[1];
  }
  if (method !== 'GET' && method !== 'HEAD') return null;
  const inbox = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/inbox$/i.exec(path);
  if (inbox) return role !== 'content_creator' ? inbox[1] : null;
  const earnings = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/earnings$/i.exec(path);
  if (earnings) return role === 'model' ? earnings[1] : null;
  if (path === '/api/v1/models' || path === '/api/v1/models/stats/count') return 'discovery';
  const requests = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/custom-requests$/i.exec(path);
  if (requests && role !== 'content_creator') return requests[1];
  if (role !== 'content_creator') {
    const fan = /^\/api\/v1\/fans\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
    if (fan) return `fan:${fan[1]}`;
  }
  if (role !== 'chatter') {
    const insight = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(viral|reports\/monthly)$/i.exec(path);
    if (insight) return insight[1];
    if (path === '/api/v1/bundles') return 'discovery';
    const bundle = /^\/api\/v1\/bundles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/media)?$/i.exec(path);
    if (bundle) return `bundle:${bundle[1]}`;
    const media = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/media(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.exec(path);
    if (media) return media[1];
  }
  const match = /^\/api\/v1\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(calendar|analytics|fans))?$/i.exec(path);
  if (!match) return null;
  const view = match[2];
  if (role === 'chatter' && view !== undefined && view !== 'fans') return null;
  if (role === 'content_creator' && view === 'fans') return null;
  return match[1];
}

// Mount after session middleware and before any REST route handlers. New roles
// remain disabled in auth until their complete route/navigation policy is ready.
export async function enforceModelAccess(c: Context<AppBindings>, next: Next) {
  const role = c.get('role');
  if (!isScopedHumanRole(role)) return next();
  const orgId = c.get('orgId'), userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  const target = scopedReadTarget(role, c.req.method, c.req.path);
  if (!target) return apiError(c, 403, statusTitle(403), 'operation is not available to this role');
  if (target === 'self-subscription') return next();
  if (target === 'self-shifts') return next();
  if (target === 'bundle-create') return next();
  if (target.startsWith('fan:')) {
    const allowed = await withOrgContext(orgId, tx => tx.select({ id: schema.fanCrmContact.id }).from(schema.fanCrmContact)
      .where(and(eq(schema.fanCrmContact.orgId, orgId), eq(schema.fanCrmContact.id, target.slice(4)),
        modelAccessCondition(role, orgId, userId, schema.fanCrmContact.modelId))).limit(1));
    if (!allowed.length) return apiError(c, 404, statusTitle(404), 'fan unavailable');
    return next();
  }
  if (target.startsWith('bundle:')) {
    const allowed = await withOrgContext(orgId, tx => tx.select({ id: schema.contentBundle.id }).from(schema.contentBundle)
      .where(and(eq(schema.contentBundle.orgId, orgId), eq(schema.contentBundle.id, target.slice(7)),
        modelAccessCondition(role, orgId, userId, schema.contentBundle.modelId))).limit(1));
    if (!allowed.length) return apiError(c, 404, statusTitle(404), 'bundle unavailable');
    return next();
  }
  if (target !== 'discovery') {
    const allowed = await withOrgContext(orgId, tx => tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, target), modelAccessCondition(role, orgId, userId))).limit(1));
    if (!allowed.length) return apiError(c, 404, statusTitle(404), 'assigned model or active shift unavailable');
  }
  return next();
}
