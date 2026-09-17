// ─── Team collaboration and shifts (F-24/F-25/F-26) ───────────────────────
// Human coordination state is model-scoped and independent from publishing.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, desc, eq, lt, or } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const shiftSchema = z.object({ assigneeUserId: z.string().trim().min(1).max(200), queue: z.string().trim().min(1).max(100).default('inbox'), startsAt: z.string().datetime(), endsAt: z.string().datetime(), note: z.string().trim().max(2_000).optional() }).strict();
const shiftPatchSchema = z.object({ status: z.enum(['scheduled', 'active', 'completed', 'cancelled']), note: z.string().trim().max(2_000).optional() }).strict();
const noteSchema = z.object({ targetType: z.enum(['model', 'post']).default('model'), targetId: z.string().uuid().optional(), body: z.string().trim().min(1).max(4_000) }).strict().refine(value => value.targetType === 'post' ? !!value.targetId : value.targetId === undefined);

async function ownedPost(tx: any, orgId: string, modelId: string, postId: string) {
  const rows = await tx.select({ id: schema.postTarget.id }).from(schema.postTarget)
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.postTarget.bundleId))
    .where(and(eq(schema.postTarget.id, postId), eq(schema.postTarget.orgId, orgId),
      eq(schema.contentBundle.orgId, orgId), eq(schema.contentBundle.modelId, modelId))).limit(1);
  return rows.length > 0;
}

router.get('/models/:modelId/team-notes', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const postId = c.req.query('postId'), cursor = c.req.query('cursor');
  if (!z.string().uuid().safeParse(postId).success || (cursor && !z.string().uuid().safeParse(cursor).success))
    return apiError(c, 400, statusTitle(400), 'valid postId and cursor required');
  const result = await withOrgContext(orgId, async tx => {
    if (!await ownedPost(tx, orgId, c.req.param('modelId'), postId!)) return null;
    const scope = and(eq(schema.teamNote.orgId, orgId), eq(schema.teamNote.modelId, c.req.param('modelId')), eq(schema.teamNote.targetType, 'post'), eq(schema.teamNote.targetId, postId!));
    const [before] = cursor ? await tx.select().from(schema.teamNote).where(and(scope, eq(schema.teamNote.id, cursor))).limit(1) : [];
    if (cursor && !before) return 'invalid-cursor' as const;
    const rows = await tx.select().from(schema.teamNote).where(and(scope, before ? or(lt(schema.teamNote.createdAt, before.createdAt), and(eq(schema.teamNote.createdAt, before.createdAt), lt(schema.teamNote.id, before.id))) : undefined))
      .orderBy(desc(schema.teamNote.createdAt), desc(schema.teamNote.id)).limit(51);
    return { data: rows.slice(0, 50), meta: { next_cursor: rows.length > 50 ? rows[49].id : null } };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'post not found');
  if (result === 'invalid-cursor') return apiError(c, 400, statusTitle(400), 'invalid note cursor');
  return c.json(result);
});

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

function windowValid(startsAt: string, endsAt: string): boolean {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 24 * 60 * 60 * 1000 * 7;
}

export function canTransitionShift(from: string, to: string): boolean {
  if (!['scheduled', 'active', 'completed', 'cancelled'].includes(from)) return false;
  return from === to || (from === 'scheduled' && ['active', 'cancelled'].includes(to))
    || (from === 'active' && ['completed', 'cancelled'].includes(to));
}

async function modelExists(tx: any, orgId: string, modelId: string): Promise<boolean> {
  return (await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1)).length > 0;
}

router.get('/models/:modelId/team-operations', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const data = await withOrgContext(orgId, async (tx) => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1);
    if (!model) return null;
    const [members, shifts, notes] = await Promise.all([
      tx.select({ id: schema.authUser.id, email: schema.authUser.email, role: schema.authUser.role }).from(schema.authUser).where(eq(schema.authUser.orgId, orgId)).orderBy(asc(schema.authUser.email)),
      tx.select().from(schema.teamShift).where(and(eq(schema.teamShift.orgId, orgId), eq(schema.teamShift.modelId, modelId))).orderBy(asc(schema.teamShift.startsAt)).limit(100),
      tx.select().from(schema.teamNote).where(and(eq(schema.teamNote.orgId, orgId), eq(schema.teamNote.modelId, modelId))).orderBy(desc(schema.teamNote.createdAt)).limit(100),
    ]);
    return { members, shifts, notes };
  });
  if (!data) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data });
});

router.post('/models/:modelId/team-shifts', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'shift body too large'); payload = {}; }
  const parsed = shiftSchema.safeParse(payload);
  if (!parsed.success || !windowValid(parsed.data.startsAt, parsed.data.endsAt)) return apiError(c, 400, statusTitle(400), 'a valid shift window of seven days or less is required');
  const modelId = c.req.param('modelId');
  const saved = await withOrgContext(orgId, async (tx) => {
    if (!(await modelExists(tx, orgId, modelId))) return { status: 404 as const, error: 'model not found' };
    const [member] = await tx.select({ id: schema.authUser.id }).from(schema.authUser).where(and(eq(schema.authUser.id, parsed.data.assigneeUserId), eq(schema.authUser.orgId, orgId))).limit(1);
    if (!member) return { status: 409 as const, error: 'assignee is not a member of this workspace' };
    const [row] = await tx.insert(schema.teamShift).values({ orgId, modelId, assigneeUserId: parsed.data.assigneeUserId, queue: parsed.data.queue, startsAt: new Date(parsed.data.startsAt), endsAt: new Date(parsed.data.endsAt), note: parsed.data.note }).returning();
    if (row) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'team.shift.create', row.id, { modelId, assigneeUserId: row.assigneeUserId, queue: row.queue });
    return row ? { status: 201 as const, data: row } : { status: 500 as const, error: 'shift could not be saved' };
  });
  if (saved.status !== 201) return apiError(c, saved.status, statusTitle(saved.status), saved.error);
  return c.json({ data: saved.data }, 201);
});

router.patch('/models/:modelId/team-shifts/:shiftId', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'shift body too large'); payload = {}; }
  const parsed = shiftPatchSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid shift update');
  const row = await withOrgContext(orgId, async (tx) => {
    const [current] = await tx.select().from(schema.teamShift).where(and(eq(schema.teamShift.id, c.req.param('shiftId')), eq(schema.teamShift.modelId, c.req.param('modelId')), eq(schema.teamShift.orgId, orgId))).limit(1).for('update');
    if (!current) return null;
    if (!canTransitionShift(current.status, parsed.data.status)) return 'conflict' as const;
    // Terminal handoffs are immutable; an identical replay is harmless.
    if (['completed', 'cancelled'].includes(current.status)) {
      if (parsed.data.note !== undefined && parsed.data.note !== current.note) return 'conflict' as const;
      return current;
    }
    if (current.status === parsed.data.status && (parsed.data.note === undefined || parsed.data.note === current.note)) return current;
    const [updated] = await tx.update(schema.teamShift).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(schema.teamShift.id, c.req.param('shiftId')), eq(schema.teamShift.modelId, c.req.param('modelId')), eq(schema.teamShift.orgId, orgId))).returning();
    if (updated) await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'team.shift.update', updated.id, { status: updated.status });
    return updated ?? null;
  });
  if (!row) return apiError(c, 404, statusTitle(404), 'shift not found');
  if (row === 'conflict') return apiError(c, 409, statusTitle(409), 'Shift changed or is already closed. Refresh before changing its status. Completed and cancelled shifts cannot be reopened.');
  return c.json({ data: row });
});

router.post('/models/:modelId/team-notes', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authentication required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'note body too large'); payload = {}; }
  const parsed = noteSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'note body is required');
  const row = await withOrgContext(orgId, async (tx) => {
    if (!(await modelExists(tx, orgId, c.req.param('modelId')))) return null;
    if (parsed.data.targetType === 'post' && !await ownedPost(tx, orgId, c.req.param('modelId'), parsed.data.targetId!)) return null;
    const [saved] = await tx.insert(schema.teamNote).values({ orgId, modelId: c.req.param('modelId'), authorUserId: userId, targetType: parsed.data.targetType, targetId: parsed.data.targetId, body: parsed.data.body }).returning();
    if (saved) await writeAudit(tx, orgId, userId, 'team.note.create', saved.id, { modelId: saved.modelId, targetType: saved.targetType });
    return saved ?? null;
  });
  if (!row) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: row }, 201);
});

export { router as teamOperationsRouter };
