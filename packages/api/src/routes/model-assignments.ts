import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, gt } from 'drizzle-orm';
import { db, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { apiError, statusTitle, withOrgContext, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const root = '/models/:modelId/member-assignments';
const uuid = z.string().uuid();
const grantSchema = z.object({ userId: z.string().min(1).max(200) }).strict();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Keep the authorization check with the router as well as at application entry.
// Assignment management never doubles as role elevation or publication approval.
router.use(`${root}/*`, async (c, next) => {
  if (!c.get('userId') || !c.get('orgId')) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (c.get('role') !== 'owner') return apiError(c, 403, statusTitle(403), 'workspace owner required');
  if (!uuid.safeParse(c.req.param('modelId')).success) return apiError(c, 400, statusTitle(400), 'valid model ID required');
  await next();
});

async function lockModel(tx: Transaction, orgId: string, modelId: string) {
  const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
    .where(and(eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId))).for('update');
  return model;
}

router.get(root, async c => {
  const orgId = c.get('orgId'), modelId = c.req.param('modelId'), cursor = c.req.query('cursor');
  if (cursor && !uuid.safeParse(cursor).success) return apiError(c, 400, statusTitle(400), 'valid assignment cursor required');
  const result = await withOrgContext(orgId, async (tx: Transaction) => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.orgId, orgId), eq(schema.modelProfile.id, modelId)));
    if (!model) return null;
    const a = schema.modelUserAssignment;
    const rows = await tx.select({ id: a.id, modelId: a.modelId, userId: a.userId, createdAt: a.createdAt,
      name: schema.authUser.name, role: schema.authUser.role }).from(a)
      .innerJoin(schema.authUser, and(eq(schema.authUser.id, a.userId), eq(schema.authUser.orgId, a.orgId)))
      .where(and(eq(a.orgId, orgId), eq(a.modelId, modelId), cursor ? gt(a.id, cursor) : undefined))
      .orderBy(asc(a.id)).limit(51);
    return { data: rows.slice(0, 50), meta: { next_cursor: rows.length > 50 ? rows[49].id : null } };
  });
  return result ? c.json(result) : apiError(c, 404, statusTitle(404), 'model not found');
});

router.post(root, async c => {
  let body: unknown;
  try { body = await readBoundedJson(c.req.raw, 4096); }
  catch (error) { return apiError(c, error instanceof RequestBodyTooLargeError ? 413 : 400, 'Invalid request', 'bounded JSON assignment required'); }
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'userId required; roles cannot be changed here');
  const orgId = c.get('orgId'), modelId = c.req.param('modelId'), userId = parsed.data.userId;
  const result = await withOrgContext(orgId, async (tx: Transaction) => {
    if (!await lockModel(tx, orgId, modelId)) return null;
    const [member] = await tx.select({ id: schema.authUser.id }).from(schema.authUser)
      .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, userId))).for('key share');
    if (!member) return null;
    const a = schema.modelUserAssignment;
    const [existing] = await tx.select().from(a).where(and(eq(a.orgId, orgId), eq(a.modelId, modelId), eq(a.userId, userId)));
    if (existing) return { data: existing, created: false };
    const [grant] = await tx.insert(a).values({ orgId, modelId, userId }).returning();
    await writeAudit(tx, orgId, c.get('userId'), 'team.assignment.grant', grant.id, { modelId, userId });
    return { data: grant, created: true };
  });
  return result ? c.json({ data: result.data }, result.created ? 201 : 200)
    : apiError(c, 404, statusTitle(404), 'workspace model or member not found');
});

router.delete(`${root}/:assignmentId`, async c => {
  const assignmentId = c.req.param('assignmentId');
  if (!uuid.safeParse(assignmentId).success) return apiError(c, 400, statusTitle(400), 'valid assignment ID required');
  const orgId = c.get('orgId'), modelId = c.req.param('modelId');
  const removed = await withOrgContext(orgId, async (tx: Transaction) => {
    if (!await lockModel(tx, orgId, modelId)) return null;
    const a = schema.modelUserAssignment;
    const [grant] = await tx.delete(a).where(and(eq(a.orgId, orgId), eq(a.modelId, modelId), eq(a.id, assignmentId))).returning();
    if (grant) await writeAudit(tx, orgId, c.get('userId'), 'team.assignment.revoke', grant.id, { modelId, userId: grant.userId });
    return grant;
  });
  return removed ? c.json({ data: { id: removed.id, revoked: true } })
    : apiError(c, 404, statusTitle(404), 'assignment not found');
});

export { router as modelAssignmentsRouter };
