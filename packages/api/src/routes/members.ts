import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, gt } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { assignableMemberRoles, changeMemberRole } from '../member-roles.js';
import { boundedJsonValidator } from '../bounded-json-validator.js';
import { apiError, statusTitle, withOrgContext } from './helpers.js';

const router = new Hono<AppBindings>();
const memberId = z.string().min(1).max(200);
router.use('/members/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!c.get('orgId') || !c.get('userId')) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (c.get('role') !== 'owner') return apiError(c, 403, statusTitle(403), 'workspace owner required');
  await next();
});
router.get('/members', async c => {
  const parsed = memberId.optional().safeParse(c.req.query('cursor'));
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'valid member cursor required');
  const cursor = parsed.data, orgId = c.get('orgId'), actorId = c.get('userId');
  const result = await withOrgContext(orgId, async tx => {
    const [actor] = await tx.select({ role: schema.authUser.role }).from(schema.authUser)
      .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, actorId))).limit(1);
    if (actor?.role !== 'owner') return null;
    const scope = eq(schema.authUser.orgId, orgId);
    if (cursor) {
      const [before] = await tx.select({ id: schema.authUser.id }).from(schema.authUser).where(and(scope, eq(schema.authUser.id, cursor))).limit(1);
      if (!before) return 'cursor' as const;
    }
    const rows = await tx.select({ id: schema.authUser.id, name: schema.authUser.name, email: schema.authUser.email, role: schema.authUser.role })
      .from(schema.authUser).where(and(scope, cursor ? gt(schema.authUser.id, cursor) : undefined)).orderBy(asc(schema.authUser.id)).limit(51);
    return { data: rows.slice(0, 50), meta: { next_cursor: rows.length > 50 ? rows[49].id : null, assignable_roles: assignableMemberRoles } };
  });
  if (!result) return apiError(c, 403, statusTitle(403), 'current workspace owner required');
  if (result === 'cursor') return apiError(c, 400, statusTitle(400), 'invalid member cursor');
  return c.json(result);
});
router.patch('/members/:userId/role', boundedJsonValidator('json', z.object({ expectedRole: z.string().min(1).max(50), role: z.enum(assignableMemberRoles) }).strict()), async c => {
  const parsed = memberId.safeParse(c.req.param('userId'));
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'valid member required');
  const result = await changeMemberRole({ orgId: c.get('orgId'), actorUserId: c.get('userId'), userId: parsed.data, ...c.req.valid('json') });
  if (result.outcome === 'changed' || result.outcome === 'unchanged') return c.json({ data: { id: result.userId, role: result.role, sessionsRevoked: result.outcome === 'changed' } });
  if (result.outcome === 'denied') return apiError(c, 403, statusTitle(403), 'current workspace owner required');
  if (result.outcome === 'missing') return apiError(c, 404, statusTitle(404), 'workspace member not found');
  if (result.outcome === 'last-owner') return apiError(c, 409, statusTitle(409), 'another owner is required before removing this owner role');
  if (result.outcome === 'conflict') return apiError(c, 409, statusTitle(409), 'member role changed; reload members before editing');
  return apiError(c, 400, statusTitle(400), 'role is not currently assignable');
});
export { router as membersRouter };
