import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { auth, requireAuth, requireMutationRole } from '@axiom/auth';
import type { AppBindings } from '../index.js';
import { teamOperationsRouter } from './team-operations.js';
import { modelAssignmentsRouter } from './model-assignments.js';
import { modelsRouter } from './models.js';
import { bundlesRouter } from './bundles.js';
import { mediaUploadRouter } from './media-upload.js';
import { fansRouter } from './fans.js';
import { generateRouter } from './generate.js';
import { mediaOperationsRouter } from './media-operations.js';
import { playbookRouter } from './playbook.js';
import { playbookGuidelinesRouter } from './playbook-guidelines.js';
import { analyticsRouter } from './analytics.js';
import { earningsRouter } from './earnings.js';
import { inboxRouter } from './inbox.js';
import { inboxRepliesRouter } from './inbox-replies.js';
import { inboxReviewsRouter } from './inbox-reviews.js';
import { changeMemberRole } from '../member-roles.js';
import { membersRouter } from './members.js';
import { claimReplyDispatch, finalizeReplyDispatch, dispatchReply, cancelReply } from '../reply-dispatch.js';
import { FanvueConnector } from '@axiom/connectors';
import { viralRouter } from './viral.js';
import { reportsRouter } from './reports.js';
import { enforceModelAccess, type ScopedHumanRole } from '../model-access.js';

const url = process.env.TEST_DATABASE_URL, orgId = '11111111-1111-4111-8111-111111111111';
const models = [randomUUID(), randomUUID()], bundles: string[] = [randomUUID(), randomUUID()], posts = [randomUUID(), randomUUID()];
const assignmentUsers = [randomUUID(), randomUUID()];
const pageUsers = Array.from({ length: 51 }, () => randomUUID());
const foreignOrg = randomUUID(), foreignModel = randomUUID();
const assets = [randomUUID(), randomUUID()];
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let mediaRoot: string | undefined;
const previousMediaRoot = process.env.AXIOM_MEDIA_ROOT;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const scoped = <T>(operation: (tx: Transaction) => Promise<T>, org = orgId) => db.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${org}, true)`); return operation(tx);
});
function app(org = orgId, role: AppBindings['Variables']['role'] = 'owner') {
  const route = new Hono<AppBindings>();
  route.use('*', async (c, next) => { c.set('orgId', org); c.set('userId', 'fixture-operator'); c.set('role', role); await next(); });
  route.route('/', teamOperationsRouter);
  route.route('/', modelAssignmentsRouter); return route;
}
const path = `/models/${models[0]}/team-notes`;
function scopedApp(role: ScopedHumanRole, org = orgId, userId = assignmentUsers[0]) {
  const route = new Hono<AppBindings>();
  route.use('*', async (c, next) => { c.set('orgId', org); c.set('userId', userId); c.set('role', role); await next(); });
  route.use('/api/v1/*', enforceModelAccess);
  route.use('/api/v1/*', requireMutationRole('owner', 'manager', 'operator', 'content_creator', 'chatter'));
  route.route('/api/v1/models', modelsRouter);
  route.route('/api/v1/bundles', bundlesRouter);
  route.route('/api/v1', mediaUploadRouter);
  route.route('/api/v1', fansRouter);
  route.route('/api/v1', generateRouter);
  route.route('/api/v1', mediaOperationsRouter);
  route.route('/api/v1', teamOperationsRouter);
  route.route('/api/v1', playbookRouter);
  route.route('/api/v1', playbookGuidelinesRouter);
  route.route('/api/v1', analyticsRouter);
  route.route('/api/v1', earningsRouter);
  route.route('/api/v1', inboxRouter);
  route.route('/api/v1', inboxRepliesRouter);
  route.route('/api/v1', inboxReviewsRouter);
  route.route('/api/v1', viralRouter);
  route.route('/api/v1', reportsRouter);
  return route;
}
const write = (postId: string, org = orgId) => app(org).request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'post', targetId: postId, body: 'Post handoff context' }) });
type Page = { data: { id: string; body: string; authorUserId: string; targetId: string }[]; meta: { next_cursor: string | null } };
describe.skipIf(!url)('team operations in PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    expect((await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    mediaRoot = await mkdtemp(join(tmpdir(), 'axiom-team-media-'));
    process.env.AXIOM_MEDIA_ROOT = mediaRoot;
    await writeFile(join(mediaRoot, 'fixture.png'), imageBytes);
    await scoped(async tx => {
      await tx.insert(schema.authUser).values({ id: assignmentUsers[0], orgId, name: 'Assignment fixture', email: `${assignmentUsers[0]}@example.invalid` });
      await tx.insert(schema.modelProfile).values(models.map(id => ({ id, orgId, displayName: 'Team fixture', handle: id })));
      for (let i = 0; i < 2; i++) {
        await tx.insert(schema.asset).values({ id: assets[i], orgId, modelId: models[i], fileName: 'fixture.png', mimeType: 'image/png', fileSize: imageBytes.length, storageKey: 'fixture.png', sha256: i === 0 ? createHash('sha256').update(imageBytes).digest() : createHash('sha256').update('unreadable-other-model-fixture').digest() });
        await tx.insert(schema.contentBundle).values({ id: bundles[i], orgId, modelId: models[i], assetId: assets[i], captions: { x: 'Test' } });
        await tx.insert(schema.postTarget).values({ id: posts[i], orgId, bundleId: bundles[i], platform: 'x', state: 'pending', idemKey: Buffer.from(randomUUID()) });
      }
    });
    await scoped(async tx => {
      await tx.insert(schema.org).values({ id: foreignOrg, name: 'Assignment isolation fixture', slug: foreignOrg });
      await tx.insert(schema.authUser).values({ id: assignmentUsers[1], orgId: foreignOrg, name: 'Other tenant fixture', email: `${assignmentUsers[1]}@example.invalid` });
      await tx.insert(schema.modelProfile).values({ id: foreignModel, orgId: foreignOrg, displayName: 'Other tenant model', handle: foreignModel });
    }, foreignOrg);
  });
  afterAll(async () => {
    await scoped(async tx => {
      await tx.delete(schema.postTarget).where(inArray(schema.postTarget.id, posts));
      await tx.delete(schema.contentBundle).where(inArray(schema.contentBundle.id, bundles));
      await tx.delete(schema.asset).where(inArray(schema.asset.id, assets));
      await tx.delete(schema.modelProfile).where(inArray(schema.modelProfile.id, models));
      await tx.delete(schema.authUser).where(inArray(schema.authUser.id, [assignmentUsers[0], ...pageUsers]));
    });
    await scoped(async tx => {
      await tx.delete(schema.modelProfile).where(eq(schema.modelProfile.id, foreignModel));
      await tx.delete(schema.authUser).where(eq(schema.authUser.id, assignmentUsers[1]));
      await tx.delete(schema.org).where(eq(schema.org.id, foreignOrg));
    }, foreignOrg);
    await pool.end();
    if (previousMediaRoot === undefined) delete process.env.AXIOM_MEDIA_ROOT;
    else process.env.AXIOM_MEDIA_ROOT = previousMediaRoot;
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });
  it('persists a post-linked note with the authenticated author', async () => {
    const result = await write(posts[0]); expect(result.status).toBe(201);
    const { data } = await result.json() as { data: Page['data'][number] };
    expect(data).toMatchObject({ targetId: posts[0], authorUserId: 'fixture-operator', body: 'Post handoff context' });
    const read = await app().request(`${path}?postId=${posts[0]}`);
    expect((await read.json() as Page).data.map(row => row.id)).toContain(data.id);
  });
  it('edits assigned Creator drafts with revision conflict protection and fresh scan, never publishing', async () => {
    const userId = randomUUID(), assignmentId = randomUUID(), bundleId = randomUUID();
    await scoped(async tx => {
      await tx.insert(schema.authUser).values({ id: userId, orgId, name: 'Draft editor', email: `${userId}@example.invalid`, role: 'content_creator' });
      await tx.insert(schema.modelUserAssignment).values({ id: assignmentId, orgId, modelId: models[0], userId });
      await tx.insert(schema.contentBundle).values({ id: bundleId, orgId, modelId: models[0], assetId: assets[0], state: 'generated', captions: { x: 'Original' }, tosReport: { verdict: 'pass' } });
    });
    const body = { expectedRevisionId: null, captions: { x: 'Edited caption' }, hashtags: ['studio'], scheduleRequest: { platform: 'x', scheduledAt: new Date(Date.now() + 3600_000).toISOString() } };
    const patch = (input: unknown, id: string = bundleId, role: ScopedHumanRole = 'content_creator') => scopedApp(role, orgId, userId).request(`/api/v1/bundles/${id}/draft`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    try {
      expect((await patch(body, bundleId, 'model')).status).toBe(403);
      expect((await patch(body, bundles[1])).status).toBe(404);
      expect((await patch({ ...body, scheduleRequest: { ...body.scheduleRequest, platform: 'instagram' } })).status).toBe(400);
      expect((await patch({ ...body, state: 'approved' })).status).toBe(400);
      const edits = await Promise.all([patch(body), patch({ ...body, captions: { x: 'Concurrent edit' } })]);
      expect(edits.map(response => response.status).sort()).toEqual([200, 409]);
      const saved = await edits.find(response => response.status === 200)!.json() as { data: { tosReport: { verdict: string; revisionId: string }; state: string; publishIntent: unknown } };
      expect(saved.data.state).toBe('generated'); expect(saved.data.tosReport.verdict).toBe('pending');
      expect(saved.data.tosReport.revisionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved.data.publishIntent).toEqual({ action: 'schedule', ...body.scheduleRequest });
      const jobs = await scoped(tx => tx.select().from(schema.job).where(sql`${schema.job.payload}->>'bundleId' = ${bundleId}`));
      expect(jobs.map(job => job.kind)).toEqual(['tos.scan']);
      expect(await scoped(tx => tx.select().from(schema.postTarget).where(eq(schema.postTarget.bundleId, bundleId)))).toHaveLength(0);
      expect((await patch(body)).status).toBe(409);
      await scoped(tx => tx.update(schema.contentBundle).set({ state: 'approved' }).where(eq(schema.contentBundle.id, bundleId)));
      expect((await patch({ ...body, expectedRevisionId: saved.data.tosReport.revisionId })).status).toBe(409);
      await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, assignmentId)));
      expect((await patch(body)).status).toBe(404);
    } finally {
      await scoped(async tx => {
        await tx.delete(schema.job).where(sql`${schema.job.payload}->>'bundleId' = ${bundleId}`);
        await tx.delete(schema.contentBundle).where(eq(schema.contentBundle.id, bundleId));
        await tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, assignmentId));
        await tx.delete(schema.authUser).where(eq(schema.authUser.id, userId));
      });
    }
  });
  it.each(['content_creator', 'model', 'chatter'] as const)('enforces assignment and session revocation through real signed-in %s sessions', async role => {
    const email = `${randomUUID()}@example.invalid`;
    const origin = new URL(String(auth.options.baseURL)).origin;
    const signup = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password: `Fixture-${randomUUID()}`, name: 'Scoped session fixture' }),
    }));
    expect(signup.status).toBe(200);
    const identity = await signup.json() as { user: { id: string } };
    const userId = identity.user.id;
    const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    expect(cookie).toContain('session_token=');
    const assignmentId = randomUUID(), shiftId = randomUUID();
    await scoped(async tx => {
      await tx.update(schema.authUser).set({ orgId, role }).where(eq(schema.authUser.id, userId));
      await tx.insert(schema.modelUserAssignment).values({ id: assignmentId, orgId, modelId: models[0], userId });
      if (role === 'chatter') await tx.insert(schema.teamShift).values({ id: shiftId, orgId, modelId: models[0], assigneeUserId: userId, status: 'active', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 600_000) });
    });
    const route = new Hono<AppBindings>();
    route.use('/api/v1/*', requireAuth);
    route.use('/api/v1/*', enforceModelAccess);
    route.route('/api/v1/models', modelsRouter);
    route.route('/api/v1/bundles', bundlesRouter);
    route.route('/api/v1', membersRouter);
    const request = (path: string, method = 'GET') => route.request(path, { method, headers: { Cookie: cookie } });
    try {
      expect((await request(`/api/v1/models/${models[0]}`)).status).toBe(200);
      for (const id of [models[1], foreignModel]) expect((await request(`/api/v1/models/${id}`)).status).toBe(404);
      expect((await request('/api/v1/members')).status).toBe(403);
      expect((await request(`/api/v1/models/${models[0]}`, 'DELETE')).status).toBe(403);
      expect((await request(`/api/v1/bundles/${bundles[0]}/approve`, 'POST')).status).toBe(403);
      if (role === 'chatter') {
        await scoped(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(schema.teamShift.id, shiftId)));
        expect((await request(`/api/v1/models/${models[0]}`)).status).toBe(404);
      }
      await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, assignmentId)));
      expect((await request(`/api/v1/models/${models[0]}`)).status).toBe(404);
      await scoped(tx => tx.delete(schema.authSession).where(eq(schema.authSession.userId, userId)));
      expect((await request('/api/v1/models')).status).toBe(401);
    } finally {
      await scoped(async tx => {
        await tx.delete(schema.teamShift).where(eq(schema.teamShift.id, shiftId));
        await tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, assignmentId));
        await tx.delete(schema.authUser).where(eq(schema.authUser.id, userId));
      });
    }
  });
  it('serializes member role changes, preserves an owner and revokes old sessions atomically', async () => {
    const tenant = randomUUID(), owner = randomUUID(), member = randomUUID(), sessionId = randomUUID();
    const run = <T>(fn: (tx: Transaction) => Promise<T>) => scoped(fn, tenant);
    await run(async tx => {
      await tx.insert(schema.org).values({ id: tenant, name: 'Roles fixture', slug: tenant });
      await tx.insert(schema.authUser).values([
        { id: owner, orgId: tenant, name: 'Owner', email: `${owner}@example.invalid`, role: 'owner' },
        { id: member, orgId: tenant, name: 'Member', email: `${member}@example.invalid`, role: 'operator' },
      ]);
      await tx.insert(schema.authSession).values({ id: sessionId, userId: member, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });
    });
    const input = { orgId: tenant, actorUserId: owner, userId: member, expectedRole: 'operator', role: 'manager' as const };
    expect((await changeMemberRole({ ...input, actorUserId: member })).outcome).toBe('denied');
    expect((await changeMemberRole({ ...input, userId: assignmentUsers[0] })).outcome).toBe('missing');
    expect((await changeMemberRole({ ...input, userId: owner, expectedRole: 'owner' })).outcome).toBe('last-owner');
    const results = await Promise.all([changeMemberRole(input), changeMemberRole({ ...input, role: 'analyst' })]);
    expect(results.map(value => value.outcome).sort()).toEqual(['changed', 'conflict']);
    expect(await run(tx => tx.select().from(schema.authSession).where(eq(schema.authSession.id, sessionId)))).toEqual([]);
    const audits = await run(tx => tx.select().from(schema.auditLog).where(eq(schema.auditLog.target, member)));
    expect(audits).toHaveLength(1);
    const [current] = await run(tx => tx.select().from(schema.authUser).where(eq(schema.authUser.id, member)));
    expect((await changeMemberRole({ ...input, expectedRole: current.role, role: 'owner' })).outcome).toBe('changed');
    // Both owners attempt self-demotion concurrently. The second cannot remove the last owner.
    const demotions = await Promise.all([
      changeMemberRole({ orgId: tenant, actorUserId: owner, userId: owner, expectedRole: 'owner', role: 'operator' }),
      changeMemberRole({ orgId: tenant, actorUserId: member, userId: member, expectedRole: 'owner', role: 'operator' }),
    ]);
    expect(demotions.map(value => value.outcome).sort()).toEqual(['changed', 'last-owner']);
    const owners = await run(tx => tx.select().from(schema.authUser).where(sql`${schema.authUser.orgId} = ${tenant} AND ${schema.authUser.role} = 'owner'`));
    expect(owners).toHaveLength(1);
    const currentOwner = owners[0].id, otherMember = currentOwner === owner ? member : owner;
    function memberApp(actorId = currentOwner, role: AppBindings['Variables']['role'] = 'owner') {
      const route = new Hono<AppBindings>();
      route.use('*', async (c, next) => { c.set('orgId', tenant); c.set('userId', actorId); c.set('role', role); await next(); });
      route.route('/', membersRouter); return route;
    }
    const route = memberApp();
    const extras = Array.from({ length: 51 }, () => randomUUID());
    await run(tx => tx.insert(schema.authUser).values(extras.map(id => ({ id, orgId: tenant, name: 'Page fixture', email: `${id}@example.invalid`, role: 'operator' }))));
    const response = await route.request('/members');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const first = await response.json() as { data: { id: string }[]; meta: { next_cursor: string; assignable_roles: string[] } };
    expect(first.data).toHaveLength(50); expect(first.meta.assignable_roles).toContain('chatter');
    const second = await (await route.request(`/members?cursor=${first.meta.next_cursor}`)).json() as { data: { id: string }[]; meta: { next_cursor: null } };
    expect(second.meta.next_cursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map(row => row.id))).toEqual(new Set([owner, member, ...extras]));
    expect(Object.keys(first.data[0]).sort()).toEqual(['email', 'id', 'name', 'role']);
    expect((await route.request(`/members?cursor=${assignmentUsers[0]}`)).status).toBe(400);
    expect((await memberApp(currentOwner, 'manager').request('/members')).status).toBe(403);
    expect((await memberApp(otherMember).request('/members')).status).toBe(403); // Stale owner session.
    const patch = (target: string, body: unknown) => route.request(`/members/${target}/role`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const change = await patch(otherMember, { expectedRole: 'operator', role: 'analyst' });
    expect(change.status).toBe(200); expect(await change.json()).toEqual({ data: { id: otherMember, role: 'analyst', sessionsRevoked: true } });
    expect((await patch(otherMember, { expectedRole: 'operator', role: 'manager' })).status).toBe(409);
    expect((await patch(currentOwner, { expectedRole: 'owner', role: 'operator' })).status).toBe(409);
    expect((await patch(assignmentUsers[0], { expectedRole: 'operator', role: 'manager' })).status).toBe(404);
    expect((await patch(otherMember, { expectedRole: 'analyst', role: 'agent' })).status).toBe(400);
    expect((await patch(otherMember, { expectedRole: 'analyst', role: 'manager', orgId })).status).toBe(400);
  });
  it('enforces assignment membership for both model and user at the database boundary', async () => {
    const insert = (modelId: string, userId: string) => scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId, userId }));
    await expect(insert(models[0], assignmentUsers[1])).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(insert(foreignModel, assignmentUsers[0])).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(insert(models[0], randomUUID())).rejects.toMatchObject({ cause: { code: '23503' } });
    await insert(models[0], assignmentUsers[0]);
    await expect(insert(models[0], assignmentUsers[0])).rejects.toMatchObject({ cause: { code: '23505' } });
    // A parent cannot move tenants while a grant still references its old scope.
    await expect(scoped(tx => tx.update(schema.authUser).set({ orgId: foreignOrg }).where(eq(schema.authUser.id, assignmentUsers[0])))).rejects.toMatchObject({ cause: { code: '23503' } });
  });
  it('hides assignments from other tenants, prevents retargeting, and supports explicit revocation', async () => {
    const [grant] = await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[1], userId: assignmentUsers[0] }).returning());
    const select = () => scoped(tx => tx.select().from(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, grant.id)));
    expect(await select()).toHaveLength(1);
    expect(await scoped(tx => tx.select().from(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, grant.id)), foreignOrg)).toEqual([]);
    expect(await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, grant.id)).returning(), foreignOrg)).toEqual([]);
    await expect(scoped(tx => tx.execute(sql`UPDATE model_user_assignment SET model_id = ${models[0]} WHERE id = ${grant.id}`))).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[1], userId: assignmentUsers[0] }), foreignOrg)).rejects.toMatchObject({ cause: { code: '42501' } });
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, grant.id)));
    expect(await select()).toEqual([]);
  });
  it.each(['user', 'model'] as const)('removes assignments when the referenced %s is deleted', async target => {
    await scoped(async tx => {
      const userId = randomUUID(), modelId = randomUUID();
      await tx.insert(schema.authUser).values({ id: userId, orgId, name: 'Deletion fixture', email: `${userId}@example.invalid` });
      await tx.insert(schema.modelProfile).values({ id: modelId, orgId, displayName: 'Deletion fixture', handle: modelId });
      const [grant] = await tx.insert(schema.modelUserAssignment).values({ orgId, modelId, userId }).returning();
      if (target === 'user') await tx.delete(schema.authUser).where(eq(schema.authUser.id, userId));
      else await tx.delete(schema.modelProfile).where(eq(schema.modelProfile.id, modelId));
      expect(await tx.select().from(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.id, grant.id))).toEqual([]);
      await tx.delete(schema.authUser).where(eq(schema.authUser.id, userId));
      await tx.delete(schema.modelProfile).where(eq(schema.modelProfile.id, modelId));
    });
  });
  it('rejects another model or tenant for reads and writes, and RLS hides rows', async () => {
    expect((await write(posts[1])).status).toBe(404);
    expect((await app().request(`${path}?postId=${posts[1]}`)).status).toBe(404);
    const otherOrg = randomUUID();
    expect((await write(posts[0], otherOrg)).status).toBe(404);
    expect((await app(otherOrg).request(`${path}?postId=${posts[0]}`)).status).toBe(404);
    expect(await scoped(tx => tx.select().from(schema.teamNote).where(inArray(schema.teamNote.modelId, models)), otherOrg)).toEqual([]);
  });
  it('paginates tied timestamps without omissions or duplicates', async () => {
    const ids = Array.from({ length: 52 }, () => randomUUID());
    await scoped(tx => tx.insert(schema.teamNote).values(ids.map(id => ({ id, orgId, modelId: models[0], authorUserId: 'fixture-operator', targetType: 'post', targetId: posts[0], body: id, createdAt: new Date('2030-01-01T00:00:00Z') }))));
    const first = await (await app().request(`${path}?postId=${posts[0]}`)).json() as Page;
    expect(first.data).toHaveLength(50); expect(first.meta.next_cursor).not.toBeNull();
    const second = await (await app().request(`${path}?postId=${posts[0]}&cursor=${first.meta.next_cursor}`)).json() as Page;
    const received = [...first.data, ...second.data].map(row => row.id);
    expect(new Set(received).size).toBe(received.length);
    expect(ids.every(id => received.includes(id))).toBe(true);
    expect(second.meta.next_cursor).toBeNull();
  });
  it('serializes competing shift completion and cancellation without rewriting the terminal handoff', async () => {
    const id = randomUUID();
    await scoped(tx => tx.insert(schema.teamShift).values({ id, orgId, modelId: models[0], assigneeUserId: 'fixture-operator', queue: 'inbox', startsAt: new Date(), endsAt: new Date(Date.now() + 3600000), status: 'active', note: 'Initial' }));
    const change = (status: string, note: string) => app().request(`/models/${models[0]}/team-shifts/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, note }) });
    const outcomes = await Promise.all([change('completed', 'Completed handoff'), change('cancelled', 'Cancelled handoff')]);
    expect(outcomes.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await change('active', 'Reopen')).status).toBe(409);
  });
  it.each(['manager', 'operator', 'analyst', 'agent', null] as const)('denies assignment management for role %s', async role => {
    const base = `/models/${models[0]}/member-assignments`;
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await app(orgId, role).request(method === 'DELETE' ? `${base}/${randomUUID()}` : base, { method });
      expect(response.status).toBe(403);
    }
  });
  it('requires a workspace and validates assignment inputs without role elevation', async () => {
    expect((await app('').request(`/models/${models[0]}/member-assignments`)).status).toBe(401);
    expect((await app().request('/models/invalid/member-assignments')).status).toBe(400);
    expect((await app().request(`/models/${models[0]}/member-assignments?cursor=invalid`)).status).toBe(400);
    expect((await app().request(`/models/${models[0]}/member-assignments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: assignmentUsers[0], role: 'owner' }) })).status).toBe(400);
  });
  it('serializes duplicate owner grants, audits once, and scopes revocation to model and tenant', async () => {
    const base = `/models/${models[1]}/member-assignments`;
    const send = (userId = assignmentUsers[0]) => app().request(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
    expect((await send(assignmentUsers[1])).status).toBe(404);
    const responses = await Promise.all([send(), send()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    const [{ data: grant }, { data: duplicate }] = await Promise.all(responses.map(r => r.json())) as { data: { id: string; userId: string } }[];
    expect(grant.id).toBe(duplicate.id);
    const audits = () => scoped(tx => tx.select().from(schema.auditLog).where(eq(schema.auditLog.target, grant.id)));
    expect((await audits()).map(row => row.action)).toEqual(['team.assignment.grant']);
    expect((await app(foreignOrg).request(base)).status).toBe(404);
    expect((await app().request(`/models/${models[0]}/member-assignments/${grant.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await app(foreignOrg).request(`${base}/${grant.id}`, { method: 'DELETE' })).status).toBe(404);
    const listed = await (await app().request(base)).json() as { data: { id: string; role: string }[] };
    expect(listed.data).toContainEqual(expect.objectContaining({ id: grant.id, role: 'operator' }));
    expect((await app().request(`${base}/${grant.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app().request(`${base}/${grant.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await audits()).map(row => row.action).sort()).toEqual(['team.assignment.grant', 'team.assignment.revoke']);
  });
  it('paginates assignment membership without omitting users and exposes no account secrets', async () => {
    await scoped(async tx => {
      await tx.insert(schema.authUser).values(pageUsers.map(id => ({ id, orgId, name: 'Page fixture', email: `${id}@example.invalid` })));
      await tx.insert(schema.modelUserAssignment).values(pageUsers.map(userId => ({ orgId, userId, modelId: models[1] })));
    });
    const base = `/models/${models[1]}/member-assignments`;
    type Assignments = { data: { userId: string; id: string }[]; meta: { next_cursor: string | null } };
    const first = await (await app().request(base)).json() as Assignments;
    expect(first.data).toHaveLength(50);
    expect(first.meta.next_cursor).toBe(first.data[49].id);
    const second = await (await app().request(`${base}?cursor=${first.meta.next_cursor}`)).json() as Assignments;
    expect(second.meta.next_cursor).toBeNull();
    const received = [...first.data, ...second.data];
    expect(received.map(row => row.userId).sort()).toEqual([...pageUsers].sort());
    for (const row of received) expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'modelId', 'name', 'role', 'userId']);
  });
  it.each(['model', 'content_creator'] as const)('scopes discovery, count and direct model reads for %s', async role => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const route = scopedApp(role);
    const list = await (await route.request('/api/v1/models')).json() as { data: { id: string }[] };
    expect(list.data.map(row => row.id)).toEqual([models[0]]);
    expect(await (await route.request('/api/v1/models/stats/count')).json()).toEqual({ data: { count: 1 } });
    expect((await route.request(`/api/v1/models/${models[0]}`)).status).toBe(200);
    expect((await route.request(`/api/v1/models/${models[1]}`)).status).toBe(404);
    expect((await scopedApp(role, foreignOrg).request(`/api/v1/models/${models[0]}`)).status).toBe(404);
    expect((await route.request(`/api/v1/models/${models[0]}/network`)).status).toBe(403);
    expect((await route.request(`/api/v1/models/${models[0]}`, { method: 'DELETE' })).status).toBe(403);
  });
  it('requires an active in-window shift for chatter discovery and loses access after revocation', async () => {
    const route = scopedApp('chatter'), shiftId = randomUUID();
    const count = async () => (await (await route.request('/api/v1/models/stats/count')).json() as { data: { count: number } }).data.count;
    expect(await count()).toBe(0);
    await scoped(tx => tx.insert(schema.teamShift).values({ id: shiftId, orgId, modelId: models[0], assigneeUserId: assignmentUsers[0], status: 'active', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000) }));
    expect(await count()).toBe(1);
    await scoped(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(schema.teamShift.id, shiftId)));
    expect(await count()).toBe(0);
    await scoped(tx => tx.update(schema.teamShift).set({ status: 'scheduled', endsAt: new Date(Date.now() + 60_000) }).where(eq(schema.teamShift.id, shiftId)));
    expect(await count()).toBe(0);
    await scoped(tx => tx.update(schema.teamShift).set({ status: 'active', startsAt: new Date(Date.now() + 10_000) }).where(eq(schema.teamShift.id, shiftId)));
    expect(await count()).toBe(0);
    await scoped(tx => tx.update(schema.teamShift).set({ startsAt: new Date(Date.now() - 60_000) }).where(eq(schema.teamShift.id, shiftId)));
    expect(await count()).toBe(1);
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect(await count()).toBe(0);
    expect((await route.request(`/api/v1/models/${models[0]}`)).status).toBe(404);
  });
  it.each(['model', 'content_creator'] as const)('authorizes real media bytes and filters bundle discovery for %s', async role => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const route = scopedApp(role);
    const list = await (await route.request('/api/v1/bundles')).json() as { data: { id: string }[] };
    expect(list.data.map(row => row.id)).toEqual([bundles[0]]);
    expect((await (await route.request(`/api/v1/bundles?modelId=${models[1]}`)).json() as { data: unknown[] }).data).toEqual([]);
    expect((await route.request(`/api/v1/bundles/${bundles[0]}`)).status).toBe(200);
    expect((await route.request(`/api/v1/bundles/${bundles[1]}`)).status).toBe(404);
    for (const path of [`/api/v1/bundles/${bundles[0]}/media`, `/api/v1/models/${models[0]}/media/${assets[0]}`]) {
      const response = await route.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(imageBytes);
      const partial = await route.request(path, { headers: { Range: 'bytes=0-7' } });
      expect(partial.status).toBe(206);
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(imageBytes.subarray(0, 8));
      expect((await scopedApp(role, foreignOrg).request(path)).status).toBe(404);
    }
    expect((await route.request(`/api/v1/bundles/${bundles[1]}/media`)).status).toBe(404);
    expect((await route.request(`/api/v1/models/${models[1]}/media`)).status).toBe(404);
    expect((await route.request(`/api/v1/models/${models[0]}/media/${assets[1]}`)).status).toBe(404);
    expect((await route.request(`/api/v1/bundles/${bundles[0]}/approve`, { method: 'POST' })).status).toBe(403);
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await route.request(`/api/v1/bundles/${bundles[0]}/media`)).status).toBe(404);
  });
  it.each(['model', 'chatter'] as const)('scopes fan timelines, linked requests and revoked reads for %s', async role => {
    const fanIds = [randomUUID(), randomUUID()], shiftId = randomUUID(), requestId = randomUUID();
    await scoped(async tx => {
      await tx.delete(schema.teamShift).where(eq(schema.teamShift.assigneeUserId, assignmentUsers[0]));
      await tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing();
      for (let i = 0; i < 2; i++) await tx.insert(schema.fanCrmContact).values({ id: fanIds[i], orgId, modelId: models[i], platform: 'fanvue', externalId: fanIds[i] });
      await tx.insert(schema.fanTouchpoint).values({ orgId, fanId: fanIds[0], platform: 'fanvue', kind: 'note', content: 'Owned saved timeline' });
      await tx.insert(schema.customRequest).values([
        { id: requestId, orgId, modelId: models[0], fanId: fanIds[0], title: 'Owned request' },
        { orgId, modelId: models[1], fanId: fanIds[0], title: 'Mismatched model must not leak' },
      ]);
      if (role === 'chatter') await tx.insert(schema.teamShift).values({ id: shiftId, orgId, modelId: models[0], assigneeUserId: assignmentUsers[0], status: 'active', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 600_000) });
    });
    const route = scopedApp(role), path = `/api/v1/fans/${fanIds[0]}`;
    const response = await route.request(path);
    expect(response.status).toBe(200);
    const result = await response.json() as { data: { fan: { id: string }; touchpoints: { content: string }[]; requests: { id: string }[] } };
    expect(result.data.fan.id).toBe(fanIds[0]);
    expect(result.data.touchpoints.map(row => row.content)).toEqual(['Owned saved timeline']);
    expect(result.data.requests.map(row => row.id)).toEqual([requestId]);
    const requestPath = `/api/v1/models/${models[0]}/custom-requests`;
    const tickets = await route.request(requestPath);
    expect(tickets.status).toBe(200);
    expect((await tickets.json() as { data: { id: string; modelId: string }[] }).data.every(row => row.modelId === models[0])).toBe(true);
    expect((await route.request(`/api/v1/models/${models[1]}/custom-requests`)).status).toBe(404);
    expect((await scopedApp(role, foreignOrg).request(requestPath)).status).toBe(404);
    expect((await scopedApp('content_creator').request(requestPath)).status).toBe(403);
    expect((await route.request(`/api/v1/fans/${fanIds[1]}`)).status).toBe(404);
    expect((await scopedApp(role, foreignOrg).request(path)).status).toBe(404);
    expect((await scopedApp('content_creator').request(path)).status).toBe(403);
    const listed = await (await route.request(`/api/v1/models/${models[0]}/fans`)).json() as { data: { id: string }[] };
    expect(listed.data.map(row => row.id)).toContain(fanIds[0]);
    expect(listed.data.map(row => row.id)).not.toContain(fanIds[1]);
    if (role === 'chatter') {
      await scoped(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(schema.teamShift.id, shiftId)));
      expect((await route.request(path)).status).toBe(404);
      expect((await route.request(requestPath)).status).toBe(404);
    }
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await route.request(path)).status).toBe(404);
    expect((await route.request(requestPath)).status).toBe(404);
  });
  it('permits creator post collaboration only within current model assignments', async () => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const route = scopedApp('content_creator');
    const path = `/api/v1/models/${models[0]}/team-notes`;
    const writeNote = (postId: string, target = path) => route.request(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'post', targetId: postId, body: 'Creator handoff' }) });
    const saved = await writeNote(posts[0]);
    expect(saved.status).toBe(201);
    const note = await saved.json() as { data: { id: string; authorUserId: string; modelId: string } };
    expect(note.data).toMatchObject({ authorUserId: assignmentUsers[0], modelId: models[0] });
    const read = await route.request(`${path}?postId=${posts[0]}`);
    expect(read.status).toBe(200);
    let page = await read.json() as Page;
    const notes = [...page.data];
    for (let remaining = 5; page.meta.next_cursor && remaining > 0; remaining--) {
      const older = await route.request(`${path}?postId=${posts[0]}&cursor=${page.meta.next_cursor}`);
      expect(older.status).toBe(200);
      page = await older.json() as Page;
      notes.push(...page.data);
    }
    expect(page.meta.next_cursor).toBeNull();
    expect(notes.some(row => row.id === note.data.id)).toBe(true);
    expect((await writeNote(posts[1])).status).toBe(404);
    expect((await writeNote(posts[1], `/api/v1/models/${models[1]}/team-notes`)).status).toBe(404);
    expect((await scopedApp('content_creator', foreignOrg).request(`${path}?postId=${posts[0]}`)).status).toBe(404);
    expect((await scopedApp('model').request(`${path}?postId=${posts[0]}`)).status).toBe(403);
    expect((await route.request(`/api/v1/models/${models[0]}/team-operations`)).status).toBe(403);
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await route.request(`${path}?postId=${posts[0]}`)).status).toBe(404);
    expect((await writeNote(posts[0])).status).toBe(404);
  });
  it('permits assigned creator playbook reads but not score or guideline writes', async () => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const route = scopedApp('content_creator');
    for (const section of ['playbook-score', 'playbook-guidelines', 'playbook-guidelines?history=true&platform=x']) {
      const path = `/api/v1/models/${models[0]}/${section}`;
      expect((await route.request(path)).status).toBe(200);
      expect((await route.request(`/api/v1/models/${models[1]}/${section}`)).status).toBe(404);
      expect((await scopedApp('content_creator', foreignOrg).request(path)).status).toBe(404);
      expect((await scopedApp('model').request(path)).status).toBe(403);
    }
    expect((await route.request(`/api/v1/models/${models[0]}/playbook-score/record`, { method: 'POST' })).status).toBe(403);
    expect((await route.request(`/api/v1/models/${models[0]}/playbook-guidelines`, { method: 'PUT' })).status).toBe(403);
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await route.request(`/api/v1/models/${models[0]}/playbook-score`)).status).toBe(404);
  });
  it.each(['model', 'content_creator'] as const)('scopes analytics, viral insights and PDF reports for %s', async role => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const route = scopedApp(role);
    for (const section of ['analytics', 'viral', 'reports/monthly']) {
      const path = `/api/v1/models/${models[0]}/${section}`;
      const response = await route.request(path);
      expect(response.status).toBe(200);
      if (section === 'reports/monthly') {
        expect(response.headers.get('content-type')).toBe('application/pdf');
        expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
      }
      expect((await route.request(`/api/v1/models/${models[1]}/${section}`)).status).toBe(404);
      expect((await scopedApp(role, foreignOrg).request(path)).status).toBe(404);
      expect((await scopedApp('chatter').request(path)).status).toBe(403);
    }
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    for (const section of ['analytics', 'viral', 'reports/monthly']) expect((await route.request(`/api/v1/models/${models[0]}/${section}`)).status).toBe(404);
  });
  it('isolates earnings account choices by model, tenant, platform, status and assignment', async () => {
    const ids = Array.from({ length: 4 }, () => randomUUID());
    await scoped(async tx => {
      await tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing();
      await tx.insert(schema.platformConnection).values(ids.map((id, i) => ({
        id, orgId, modelId: models[i === 1 ? 1 : 0], platform: i === 2 ? 'x' : 'fanvue',
        displayName: `Account ${i}`, encToken: Buffer.from('fixture-not-a-credential'),
        encNonce: Buffer.alloc(12), dekId: 'fixture', status: i === 3 ? 'revoked' : 'connected',
      })));
    });
    try {
      const route = scopedApp('model'), path = `/api/v1/models/${models[0]}/earnings`;
      const response = await route.request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { accounts: [{ id: ids[0], displayName: 'Account 0' }] } });
      for (const id of ids.slice(1)) expect((await route.request(`${path}?connectionId=${id}`)).status).toBe(404);
      expect((await route.request(`/api/v1/models/${models[1]}/earnings`)).status).toBe(404);
      expect((await scopedApp('model', foreignOrg).request(path)).status).toBe(404);
      for (const role of ['chatter', 'content_creator'] as const) expect((await scopedApp(role).request(path)).status).toBe(403);
      await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
      expect((await route.request(path)).status).toBe(404);
    } finally {
      await scoped(tx => tx.delete(schema.platformConnection).where(inArray(schema.platformConnection.id, ids)));
    }
  });
  it('gates inbox account discovery on exact model assignment and an active Chatter shift', async () => {
    const userId = randomUUID(), shiftId = randomUUID(), connectionId = randomUUID();
    await scoped(async tx => {
      await tx.insert(schema.authUser).values({ id: userId, orgId, name: 'Inbox test', email: `${userId}@example.invalid` });
      await tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId });
      await tx.insert(schema.platformConnection).values({ id: connectionId, orgId, modelId: models[0], platform: 'fanvue',
        displayName: 'Inbox account', encToken: Buffer.from('fixture-only'), encNonce: Buffer.alloc(12), dekId: 'fixture' });
    });
    const path = `/api/v1/models/${models[0]}/inbox`, route = scopedApp('chatter', orgId, userId);
    try {
      expect((await route.request(path)).status).toBe(404);
      await scoped(tx => tx.insert(schema.teamShift).values({ id: shiftId, orgId, modelId: models[0], assigneeUserId: userId,
        status: 'active', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000) }));
      const response = await route.request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { accounts: [{ id: connectionId, displayName: 'Inbox account' }] } });
      expect((await route.request(`/api/v1/models/${models[1]}/inbox`)).status).toBe(404);
      expect((await scopedApp('chatter', foreignOrg, userId).request(path)).status).toBe(404);
      expect((await scopedApp('content_creator', orgId, userId).request(path)).status).toBe(403);
      expect((await route.request(`${path}?connectionId=${randomUUID()}`)).status).toBe(404);
      await scoped(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.teamShift.id, shiftId)));
      expect((await route.request(path)).status).toBe(404);
      // Model access needs an assignment, not a chatter shift.
      const modelRoute = scopedApp('model', orgId, userId);
      expect((await modelRoute.request(path)).status).toBe(200);
      await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, userId)));
      expect((await modelRoute.request(path)).status).toBe(404);
    } finally {
      await scoped(async tx => {
        await tx.delete(schema.teamShift).where(eq(schema.teamShift.id, shiftId));
        await tx.delete(schema.platformConnection).where(eq(schema.platformConnection.id, connectionId));
        await tx.delete(schema.authUser).where(eq(schema.authUser.id, userId));
      });
    }
  });
  it('persists immutable reply intent and fences concurrent dispatch without cross-tenant leakage', async () => {
    // Independent rows remain until the entire disposable fixture is dropped;
    // the runtime intentionally has no DELETE privilege on reply history.
    const modelId = randomUUID(), actorUserId = randomUUID(), connectionId = randomUUID(), intentKey = randomUUID();
    await scoped(async tx => {
      await tx.insert(schema.authUser).values({ id: actorUserId, orgId, name: 'Reply test', email: `${actorUserId}@example.invalid` });
      await tx.insert(schema.modelProfile).values({ id: modelId, orgId, displayName: 'Reply test', handle: modelId });
      await tx.insert(schema.platformConnection).values({ id: connectionId, modelId, orgId, platform: 'fanvue', displayName: 'Reply test', encToken: Buffer.from('fixture'), encNonce: Buffer.alloc(12), dekId: 'fixture' });
    });
    const values = { orgId, modelId, actorUserId, connectionId, intentKey, counterpartUuid: randomUUID(), body: 'Hello from a durable intent' };
    const [intent] = await scoped(tx => tx.insert(schema.inboxReplyIntent).values(values).returning());
    await expect(scoped(tx => tx.insert(schema.inboxReplyIntent).values(values))).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(scoped(tx => tx.insert(schema.inboxReplyIntent).values({ ...values, intentKey: randomUUID(), modelId: models[0] }))).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(scoped(tx => tx.insert(schema.inboxReplyIntent).values({ ...values, intentKey: randomUUID(), actorUserId: assignmentUsers[1] }))).rejects.toMatchObject({ cause: { code: '23503' } });
    expect(await scoped(tx => tx.select().from(schema.inboxReplyIntent).where(eq(schema.inboxReplyIntent.id, intent.id)), foreignOrg)).toEqual([]);
    expect(await scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'cancelled', finalizedAt: new Date() }).where(eq(schema.inboxReplyIntent.id, intent.id)).returning(), foreignOrg)).toEqual([]);
    await expect(scoped(tx => tx.update(schema.inboxReplyIntent).set({ body: 'Changed after approval' }).where(eq(schema.inboxReplyIntent.id, intent.id)))).rejects.toThrow();
    await expect(scoped(tx => tx.delete(schema.inboxReplyIntent).where(eq(schema.inboxReplyIntent.id, intent.id)))).rejects.toMatchObject({ cause: { code: '42501' } });
    const claims = await Promise.all([0, 1].map(() => scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'dispatching', dispatchedAt: new Date() })
      .where(sql`${schema.inboxReplyIntent.id} = ${intent.id} AND ${schema.inboxReplyIntent.state} = 'pending'`).returning())));
    expect(claims.map(rows => rows.length).sort()).toEqual([0, 1]);
    await expect(scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'pending', dispatchedAt: null }).where(eq(schema.inboxReplyIntent.id, intent.id)))).rejects.toThrow();
    await expect(scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'sent', finalizedAt: new Date() }).where(eq(schema.inboxReplyIntent.id, intent.id)))).rejects.toMatchObject({ cause: { code: '23514' } });
    await scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'uncertain', finalizedAt: new Date() }).where(eq(schema.inboxReplyIntent.id, intent.id)));
    await expect(scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'pending', dispatchedAt: null, finalizedAt: null }).where(eq(schema.inboxReplyIntent.id, intent.id)))).rejects.toThrow();
    await expect(scoped(tx => tx.insert(schema.inboxReplyIntent).values({ ...values, intentKey: randomUUID(), state: 'dispatching', dispatchedAt: new Date() }))).rejects.toThrow();
    const [success] = await scoped(tx => tx.insert(schema.inboxReplyIntent).values({ ...values, intentKey: randomUUID() }).returning());
    await scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'dispatching', dispatchedAt: new Date() }).where(eq(schema.inboxReplyIntent.id, success.id)));
    const remoteMessageUuid = randomUUID();
    await scoped(tx => tx.update(schema.inboxReplyIntent).set({ state: 'sent', remoteMessageUuid, providerStatus: 201, finalizedAt: new Date() }).where(eq(schema.inboxReplyIntent.id, success.id)));
    const [saved] = await scoped(tx => tx.select().from(schema.inboxReplyIntent).where(eq(schema.inboxReplyIntent.id, success.id)));
    expect(saved).toMatchObject({ state: 'sent', remoteMessageUuid, body: values.body });
    await expect(scoped(tx => tx.update(schema.inboxReplyIntent).set({ remoteMessageUuid: randomUUID() }).where(eq(schema.inboxReplyIntent.id, success.id)))).rejects.toThrow();
  });
  it('prepares one audited Chatter reply for a stable intent and rejects changed retries or expired shifts', async () => {
    const userId = randomUUID(), modelId = randomUUID(), connectionId = randomUUID(), shiftId = randomUUID();
    await scoped(async tx => {
      await tx.insert(schema.authUser).values({ id: userId, orgId, name: 'Reply API', email: `${userId}@example.invalid` });
      await tx.insert(schema.modelProfile).values({ id: modelId, orgId, displayName: 'Reply API', handle: modelId });
      await tx.insert(schema.modelUserAssignment).values({ orgId, modelId, userId });
      await tx.insert(schema.platformConnection).values({ id: connectionId, orgId, modelId, platform: 'fanvue', displayName: 'Reply API', encToken: Buffer.from('fixture'), encNonce: Buffer.alloc(12), dekId: 'fixture' });
      await tx.insert(schema.teamShift).values({ id: shiftId, orgId, modelId, assigneeUserId: userId, status: 'active', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000) });
    });
    const route = scopedApp('chatter', orgId, userId), path = `/api/v1/models/${modelId}/inbox/replies`;
    const body = { connectionId, counterpartUuid: randomUUID(), intentKey: randomUUID(), body: 'Approved exact text' };
    const post = (value = body) => route.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const responses = await Promise.all([post(), post()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    const payloads = await Promise.all(responses.map(r => r.json())) as Array<{ data: { id: string; state: string; actorUserId: string } }>;
    expect(payloads[0].data.id).toBe(payloads[1].data.id);
    expect(payloads[0].data).toMatchObject({ state: 'pending', actorUserId: userId });
    expect((await post({ ...body, body: 'Altered retry' })).status).toBe(409);
    const query = new URLSearchParams({ connectionId, counterpartUuid: body.counterpartUuid });
    const read = await route.request(`${path}?${query}`);
    expect(read.status).toBe(200);
    expect((await read.json() as { data: unknown[] }).data).toHaveLength(1);
    expect((await route.request(`${path}?${query}&cursor=${randomUUID()}`)).status).toBe(400);
    const audit = await scoped(tx => tx.select().from(schema.auditLog).where(sql`${schema.auditLog.orgId} = ${orgId} AND ${schema.auditLog.action} = 'inbox.reply.prepare' AND ${schema.auditLog.target} = ${payloads[0].data.id}`));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(body.body);
    for (const role of ['model', 'content_creator'] as const) expect((await scopedApp(role, orgId, userId).request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(403);
    expect((await scopedApp('chatter', foreignOrg, userId).request(`${path}?${query}`)).status).toBe(404);
    await scoped(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.teamShift.id, shiftId)));
    expect((await post()).status).toBe(404);
    expect((await route.request(`${path}?${query}`)).status).toBe(404);
    // No queue/connector was invoked. Independent retained history is dropped with the fixture.
  });
  it('claims a reply once only after fresh role, shift, account, consent and safety checks', async () => {
    const testOrg = randomUUID(), userId = randomUUID(), modelId = randomUUID(), connectionId = randomUUID(), shiftId = randomUUID();
    const run = <T>(fn: (tx: Transaction) => Promise<T>) => scoped(fn, testOrg);
    await run(async tx => {
      await tx.insert(schema.org).values({ id: testOrg, name: 'Reply dispatch', slug: testOrg });
      await tx.insert(schema.authUser).values({ id: userId, orgId: testOrg, role: 'chatter', name: 'Reply dispatch', email: `${userId}@example.invalid` });
      await tx.insert(schema.modelProfile).values({ id: modelId, orgId: testOrg, displayName: 'Reply dispatch', handle: modelId });
      await tx.insert(schema.modelUserAssignment).values({ orgId: testOrg, modelId, userId });
      await tx.insert(schema.teamShift).values({ id: shiftId, orgId: testOrg, modelId, assigneeUserId: userId, status: 'active', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000) });
      await tx.insert(schema.platformConnection).values({ id: connectionId, orgId: testOrg, modelId, platform: 'fanvue', displayName: 'Reply dispatch', encToken: Buffer.from('fixture'), encNonce: Buffer.alloc(12), dekId: 'fixture' });
    });
    const create = async () => (await run(tx => tx.insert(schema.inboxReplyIntent).values({ orgId: testOrg, modelId, connectionId, actorUserId: userId, counterpartUuid: randomUUID(), intentKey: randomUUID(), body: 'Private human reply' }).returning()))[0];
    const reply = await create(), identity = { orgId: testOrg, modelId, userId, replyId: reply.id };
    const sendRoute = scopedApp('chatter', testOrg, userId);
    const requestSend = () => sendRoute.request(`/api/v1/models/${modelId}/inbox/replies/${reply.id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    expect((await claimReplyDispatch({ ...identity, orgId: orgId })).outcome).toBe('denied');
    expect((await claimReplyDispatch({ ...identity, userId: assignmentUsers[0] })).outcome).toBe('denied');
    expect((await claimReplyDispatch(identity)).outcome).toBe('halted');
    expect((await requestSend()).status).toBe(409);
    await run(tx => tx.insert(schema.orgSettings).values({ orgId: testOrg, publishingEnabled: true }));
    expect((await claimReplyDispatch(identity)).outcome).toBe('consent-required');
    expect((await requestSend()).status).toBe(409);
    await run(tx => tx.insert(schema.consentRecord).values((['2257', 'model_release', 'id_verify', 'platform_consent'] as const).map(docKind => ({ orgId: testOrg, modelId, platform: 'fanvue', consentType: docKind, docKind, granted: true, grantedAt: new Date(Date.now() - 60_000), validFrom: '2020-01-01', blobRef: 'fixture-only', sha256: Buffer.alloc(32) }))));
    await run(tx => tx.update(schema.platformConnection).set({ status: 'revoked' }).where(eq(schema.platformConnection.id, connectionId)));
    expect((await claimReplyDispatch(identity)).outcome).toBe('account-unavailable');
    await run(tx => tx.update(schema.platformConnection).set({ status: 'active' }).where(eq(schema.platformConnection.id, connectionId)));
    await run(tx => tx.update(schema.authUser).set({ role: 'model' }).where(eq(schema.authUser.id, userId)));
    expect((await claimReplyDispatch(identity)).outcome).toBe('denied');
    await run(tx => tx.update(schema.authUser).set({ role: 'chatter' }).where(eq(schema.authUser.id, userId)));
    await run(tx => tx.update(schema.modelProfile).set({ isActive: false }).where(eq(schema.modelProfile.id, modelId)));
    expect((await claimReplyDispatch(identity)).outcome).toBe('denied');
    await run(tx => tx.update(schema.modelProfile).set({ isActive: true }).where(eq(schema.modelProfile.id, modelId)));
    const claims = await Promise.all([claimReplyDispatch(identity), claimReplyDispatch(identity)]);
    expect(claims.map(c => c.outcome).sort()).toEqual(['already-dispatched', 'claimed']);
    // Crash-equivalent retry never reclaims a dispatching row.
    expect((await claimReplyDispatch(identity)).outcome).toBe('already-dispatched');
    expect((await requestSend()).status).toBe(409);
    const next = await create();
    await run(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.teamShift.id, shiftId)));
    expect((await claimReplyDispatch({ ...identity, replyId: next.id })).outcome).toBe('denied');
    // Persist the observed receipt despite shift expiry; do not allow another dispatch.
    const receipt = randomUUID();
    expect(await finalizeReplyDispatch(identity, { state: 'sent', messageUuid: receipt })).toMatchObject({ state: 'sent', remoteMessageUuid: receipt });
    expect(await finalizeReplyDispatch(identity, { state: 'uncertain' })).toBeNull();
    const audits = await run(tx => tx.select().from(schema.auditLog).where(eq(schema.auditLog.target, reply.id)));
    expect(audits.map(row => row.action).sort()).toEqual(['inbox.reply.dispatch', 'inbox.reply.sent']);
    expect(JSON.stringify(audits)).not.toContain(reply.body);
    await run(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() + 60_000) }).where(eq(schema.teamShift.id, shiftId)));
    const nextIdentity = { ...identity, replyId: next.id };
    expect((await claimReplyDispatch(nextIdentity)).outcome).toBe('claimed');
    expect(await finalizeReplyDispatch(nextIdentity, { state: 'uncertain', providerStatus: 503 })).toMatchObject({ state: 'uncertain', providerStatus: 503, remoteMessageUuid: null });
    expect((await claimReplyDispatch(nextIdentity)).outcome).toBe('already-dispatched');
    expect(await finalizeReplyDispatch(nextIdentity, { state: 'sent', messageUuid: randomUUID() })).toBeNull();
    const rejected = await create(), rejectedIdentity = { ...identity, replyId: rejected.id };
    expect((await claimReplyDispatch(rejectedIdentity)).outcome).toBe('claimed');
    expect(await finalizeReplyDispatch(rejectedIdentity, { state: 'rejected', providerStatus: 429 })).toMatchObject({ state: 'rejected', providerStatus: 429 });
    expect((await claimReplyDispatch(rejectedIdentity)).outcome).toBe('already-dispatched');
    const revoked = await create();
    await run(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, userId)));
    expect((await claimReplyDispatch({ ...identity, replyId: revoked.id })).outcome).toBe('denied');
    await run(tx => tx.insert(schema.modelUserAssignment).values({ orgId: testOrg, modelId, userId }));
    const liveShape = await create(), sendIdentity = { ...identity, replyId: liveShape.id };
    let messageRequests = 0;
    const sender = async () => {
      const connector = new FanvueConnector({ accessToken: 'fixture-only' }, async (url, init) => {
        messageRequests++;
        expect(String(url)).toBe(`https://api.fanvue.com/chats/${liveShape.counterpartUuid}/message`);
        expect(JSON.parse(String(init?.body))).toEqual({ text: liveShape.body });
        const [committed] = await run(tx => tx.select().from(schema.inboxReplyIntent).where(eq(schema.inboxReplyIntent.id, liveShape.id)));
        expect(committed.state).toBe('dispatching'); // Another connection observes the committed fence.
        return Response.json({ messageUuid: randomUUID() }, { status: 201 });
      });
      return connector.sendTextReply.bind(connector);
    };
    const outcomes = await Promise.all([dispatchReply(sendIdentity, sender), dispatchReply(sendIdentity, sender)]);
    expect(outcomes.map(value => value.outcome).sort()).toEqual(['already-dispatched', 'finished']);
    expect(messageRequests).toBe(1);
    const lost = await create(), lostIdentity = { ...identity, replyId: lost.id };
    const lostSender = async () => {
      const connector = new FanvueConnector({ accessToken: 'fixture-only' }, async () => { messageRequests++; throw new Error('private transport detail'); });
      return connector.sendTextReply.bind(connector);
    };
    expect(await dispatchReply(lostIdentity, lostSender)).toMatchObject({ outcome: 'finished', state: 'uncertain' });
    expect((await dispatchReply(lostIdentity, lostSender)).outcome).toBe('already-dispatched');
    expect(messageRequests).toBe(2);
    const halted = await create();
    const haltDuringSetup = async () => {
      await run(tx => tx.update(schema.orgSettings).set({ publishingEnabled: false }).where(eq(schema.orgSettings.orgId, testOrg)));
      return lostSender();
    };
    expect((await dispatchReply({ ...identity, replyId: halted.id }, haltDuringSetup)).outcome).toBe('halted');
    expect(messageRequests).toBe(2);
    await run(tx => tx.update(schema.orgSettings).set({ publishingEnabled: true }).where(eq(schema.orgSettings.orgId, testOrg)));
    const rotateDuringSetup = async () => {
      await run(tx => tx.update(schema.platformConnection).set({ encToken: Buffer.from('rotated-fixture') }).where(eq(schema.platformConnection.id, connectionId)));
      return lostSender();
    };
    expect((await dispatchReply({ ...identity, replyId: halted.id }, rotateDuringSetup)).outcome).toBe('account-unavailable');
    expect(messageRequests).toBe(2);
    const cancelTarget = await create(), cancelIdentity = { ...identity, replyId: cancelTarget.id };
    await run(async tx => {
      await tx.update(schema.orgSettings).set({ publishingEnabled: false }).where(eq(schema.orgSettings.orgId, testOrg));
      await tx.update(schema.modelProfile).set({ isActive: false }).where(eq(schema.modelProfile.id, modelId));
    });
    expect((await cancelReply({ ...cancelIdentity, userId: assignmentUsers[0] })).outcome).toBe('denied');
    expect((await cancelReply(cancelIdentity)).outcome).toBe('cancelled');
    expect((await cancelReply(cancelIdentity)).outcome).toBe('cancelled');
    const cancelAudits = await run(tx => tx.select().from(schema.auditLog).where(eq(schema.auditLog.target, cancelTarget.id)));
    expect(cancelAudits.map(row => row.action)).toEqual(['inbox.reply.cancelled']);
    expect((await cancelReply(sendIdentity)).outcome).toBe('already-dispatched');
    await run(async tx => {
      await tx.update(schema.orgSettings).set({ publishingEnabled: true }).where(eq(schema.orgSettings.orgId, testOrg));
      await tx.update(schema.modelProfile).set({ isActive: true }).where(eq(schema.modelProfile.id, modelId));
    });
    expect((await claimReplyDispatch(cancelIdentity)).outcome).toBe('already-dispatched');
    const race = await create(), raceIdentity = { ...identity, replyId: race.id };
    const outcomesRace = await Promise.all([cancelReply(raceIdentity), claimReplyDispatch(raceIdentity)]);
    expect(outcomesRace.map(value => value.outcome).filter(value => value === 'cancelled' || value === 'claimed')).toHaveLength(1);
    expect(outcomesRace.map(value => value.outcome)).toContain('already-dispatched');
    expect(messageRequests).toBe(2);
    const evidence = { orgId: testOrg, modelId, replyId: lost.id, actorUserId: userId, intentKey: randomUUID(), conclusion: 'observed_sent' as const, observedMessageUuid: randomUUID(), note: 'Operator found this message in the provider conversation.' };
    const [review] = await run(tx => tx.insert(schema.inboxReplyReview).values(evidence).returning());
    expect(review.evidenceSource).toBe('operator_review');
    const [originalAttempt] = await run(tx => tx.select().from(schema.inboxReplyIntent).where(eq(schema.inboxReplyIntent.id, lost.id)));
    expect(originalAttempt.state).toBe('uncertain'); expect(originalAttempt.remoteMessageUuid).toBeNull();
    expect((await claimReplyDispatch(lostIdentity)).outcome).toBe('already-dispatched');
    await expect(run(tx => tx.insert(schema.inboxReplyReview).values(evidence))).rejects.toThrow();
    await expect(run(tx => tx.insert(schema.inboxReplyReview).values({ ...evidence, intentKey: randomUUID(), observedMessageUuid: null }))).rejects.toThrow();
    await expect(run(tx => tx.insert(schema.inboxReplyReview).values({ ...evidence, intentKey: randomUUID(), conclusion: 'unresolved' }))).rejects.toThrow();
    await expect(run(tx => tx.insert(schema.inboxReplyReview).values({ ...evidence, intentKey: randomUUID(), actorUserId: assignmentUsers[0] }))).rejects.toThrow();
    await expect(run(tx => tx.insert(schema.inboxReplyReview).values({ ...evidence, intentKey: randomUUID(), modelId: models[0] }))).rejects.toThrow();
    await expect(run(tx => tx.insert(schema.inboxReplyReview).values({ ...evidence, intentKey: randomUUID(), replyId: cancelTarget.id }))).rejects.toThrow();
    await expect(run(tx => tx.update(schema.inboxReplyReview).set({ note: 'rewritten' }).where(eq(schema.inboxReplyReview.id, review.id)))).rejects.toThrow();
    await expect(run(tx => tx.delete(schema.inboxReplyReview).where(eq(schema.inboxReplyReview.id, review.id)))).rejects.toThrow();
    expect(await scoped(tx => tx.select().from(schema.inboxReplyReview).where(eq(schema.inboxReplyReview.id, review.id)))).toEqual([]);
    const [followup] = await run(tx => tx.insert(schema.inboxReplyReview).values({ ...evidence, intentKey: randomUUID(), conclusion: 'unresolved', observedMessageUuid: null, note: 'Follow-up review cannot establish an exact match.' }).returning());
    expect(followup.id).not.toBe(review.id);
    const apiReply = await create(), apiIdentity = { ...identity, replyId: apiReply.id };
    expect((await claimReplyDispatch(apiIdentity)).outcome).toBe('claimed');
    const reviewPath = `/api/v1/models/${modelId}/inbox/replies/${apiReply.id}/reviews`;
    const reviewBody = { intentKey: randomUUID(), conclusion: 'unresolved', observedMessageUuid: null, note: 'Checked the correct conversation; no exact match can be established.' };
    const postReview = (body = reviewBody) => sendRoute.request(reviewPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const saves = await Promise.all([postReview(), postReview()]);
    expect(saves.map(response => response.status).sort()).toEqual([200, 201]);
    const saved = await saves[0].json() as { data: { id: string; evidenceSource: string } };
    expect(saved.data.evidenceSource).toBe('operator_review');
    expect((await postReview({ ...reviewBody, note: 'Changed retry' })).status).toBe(409);
    expect((await postReview({ ...reviewBody, conclusion: 'observed_sent' })).status).toBe(400);
    const reviewAudits = await run(tx => tx.select().from(schema.auditLog).where(eq(schema.auditLog.target, saved.data.id)));
    expect(reviewAudits).toHaveLength(1); expect(JSON.stringify(reviewAudits)).not.toContain(reviewBody.note);
    const olderReviews = await run(tx => tx.insert(schema.inboxReplyReview).values(Array.from({ length: 51 }, () => ({
      orgId: testOrg, modelId, replyId: apiReply.id, actorUserId: userId, intentKey: randomUUID(), conclusion: 'unresolved' as const,
      note: 'Older retained observation', createdAt: new Date('2020-01-01T00:00:00Z'),
    }))).returning());
    const firstResponse = await sendRoute.request(reviewPath);
    expect(firstResponse.status).toBe(200);
    const firstReviews = await firstResponse.json() as { data: { id: string }[]; meta: { next_cursor: string } };
    expect(firstReviews.data).toHaveLength(50);
    const nextReviews = await (await sendRoute.request(`${reviewPath}?cursor=${firstReviews.meta.next_cursor}`)).json() as { data: { id: string }[]; meta: { next_cursor: null } };
    expect(nextReviews.meta.next_cursor).toBeNull();
    expect(new Set([...firstReviews.data, ...nextReviews.data].map(row => row.id))).toEqual(new Set([saved.data.id, ...olderReviews.map(row => row.id)]));
    expect((await sendRoute.request(`${reviewPath}?cursor=${review.id}`)).status).toBe(400);
    expect((await scopedApp('chatter', orgId, userId).request(reviewPath)).status).toBe(404);
    expect((await scopedApp('model', testOrg, userId).request(reviewPath)).status).toBe(200);
    expect((await scopedApp('model', testOrg, userId).request(reviewPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reviewBody) })).status).toBe(403);
    await finalizeReplyDispatch(apiIdentity, { state: 'sent', messageUuid: randomUUID() });
    expect((await postReview()).status).toBe(200); // Exact retry still works after a late receipt.
    expect((await postReview({ ...reviewBody, intentKey: randomUUID() })).status).toBe(409);
    await run(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.teamShift.id, shiftId)));
    expect((await postReview()).status).toBe(404);
    expect((await sendRoute.request(reviewPath)).status).toBe(404);
  });
  it('lists only assigned self shifts before their start without granting early model access', async () => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const existing = await scoped(tx => tx.select({ id: schema.teamShift.id }).from(schema.teamShift).where(sql`${schema.teamShift.orgId} = ${orgId} AND ${schema.teamShift.modelId} = ${models[0]} AND ${schema.teamShift.assigneeUserId} = ${assignmentUsers[0]}`));
    const own = Array.from({ length: 51 }, () => randomUUID()), other = randomUUID(), unassigned = randomUUID();
    const startsAt = new Date(Date.now() + 86_400_000), endsAt = new Date(Date.now() + 90_000_000);
    await scoped(tx => tx.insert(schema.teamShift).values([
      ...own.map(id => ({ id, orgId, modelId: models[0], assigneeUserId: assignmentUsers[0], queue: 'assigned-inbox', startsAt, endsAt, status: 'scheduled' })),
      { id: other, orgId, modelId: models[0], assigneeUserId: assignmentUsers[1], queue: 'private-other', startsAt, endsAt },
      { id: unassigned, orgId, modelId: models[1], assigneeUserId: assignmentUsers[0], queue: 'private-model', startsAt, endsAt },
    ]));
    try {
      const route = scopedApp('chatter');
      const response = await route.request('/api/v1/my-shifts');
      expect(response.status).toBe(200);
      const first = await response.json() as { data: { id: string }[]; meta: { next_cursor: string } };
      const second = await (await route.request(`/api/v1/my-shifts?cursor=${first.meta.next_cursor}`)).json() as { data: { id: string }[]; meta: { next_cursor: null } };
      expect([...first.data, ...second.data].map(row => row.id).sort()).toEqual([...own, ...existing.map(row => row.id)].sort());
      expect(second.meta.next_cursor).toBeNull();
      expect((await route.request(`/api/v1/my-shifts?cursor=${other}`)).status).toBe(400);
      expect((await route.request(`/api/v1/models/${models[0]}`)).status).toBe(404);
      expect((await scopedApp('chatter', foreignOrg).request('/api/v1/my-shifts')).status).toBe(200);
      expect(await (await scopedApp('chatter', foreignOrg).request('/api/v1/my-shifts')).json()).toMatchObject({ data: [] });
      await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
      expect(await (await route.request('/api/v1/my-shifts')).json()).toMatchObject({ data: [] });
    } finally { await scoped(tx => tx.delete(schema.teamShift).where(inArray(schema.teamShift.id, [...own, other, unassigned]))); }
  });
  it('monthly reports count one latest in-month snapshot per owned post', async () => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const records = [
      { id: randomUUID(), postTargetId: posts[0], collectedAt: new Date('2030-02-01T00:00:00Z'), views: 100, likes: 10, shares: 2, comments: 3 },
      { id: randomUUID(), postTargetId: posts[0], collectedAt: new Date('2030-02-28T23:59:59Z'), views: 140, likes: 15, shares: 4, comments: 7 },
      { id: randomUUID(), postTargetId: posts[0], collectedAt: new Date('2030-03-01T00:00:00Z'), views: 900, likes: 90, shares: 90, comments: 90 },
      { id: randomUUID(), postTargetId: posts[1], collectedAt: new Date('2030-02-28T23:59:59Z'), views: 800, likes: 80, shares: 80, comments: 80 },
    ];
    await scoped(tx => tx.insert(schema.postMetric).values(records.map(row => ({ ...row, platform: 'x', remoteId: 'fixture', source: 'provider' as const }))));
    try {
      const response = await scopedApp('model').request(`/api/v1/models/${models[0]}/reports/monthly?month=2030-02`);
      expect(response.status).toBe(200);
      const pdf = Buffer.from(await response.arrayBuffer()).toString();
      expect(pdf).toContain('(Views: 140)'); expect(pdf).toContain('(Likes: 15)');
      expect(pdf).toContain('(Shares: 4)'); expect(pdf).toContain('(Comments: 7)');
      expect(pdf).toContain('not engagement earned during the month');
      expect(pdf).not.toContain('(Views: 240)');
    } finally { await scoped(tx => tx.delete(schema.postMetric).where(inArray(schema.postMetric.id, records.map(row => row.id)))); }
  });
  it('allows creator preparation only for assigned talent and never creates publication work', async () => {
    await scoped(tx => tx.insert(schema.modelUserAssignment).values({ orgId, modelId: models[0], userId: assignmentUsers[0] }).onConflictDoNothing());
    const route = scopedApp('content_creator');
    const post = (path: string, body: unknown) => route.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const generationBody = { platforms: ['x'], enrichWithLlm: false, outfit: 'blue jacket' };
    expect((await post(`/api/v1/models/${models[1]}/generate`, generationBody)).status).toBe(404);
    expect((await scopedApp('model').request(`/api/v1/models/${models[0]}/generate`, { method: 'POST' })).status).toBe(403);
    const generated = await post(`/api/v1/models/${models[0]}/generate`, generationBody);
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json() as { data: { bundle: { id: string; state: string; modelId: string } } };
    bundles.push(generatedBody.data.bundle.id);
    expect(generatedBody.data.bundle).toMatchObject({ modelId: models[0], state: 'generated' });
    const jobs = await scoped(tx => tx.select({ kind: schema.job.kind }).from(schema.job).where(sql`${schema.job.payload}->>'bundleId' = ${generatedBody.data.bundle.id}`));
    expect(jobs.map(job => job.kind)).toEqual(['tos.scan']);
    expect((await post(`/api/v1/bundles/${generatedBody.data.bundle.id}/approve`, {})).status).toBe(403);
    const operationBody = { type: 'image_resize', width: 128, height: 128 };
    expect((await post(`/api/v1/models/${models[0]}/media-operations?assetId=${assets[1]}`, operationBody)).status).toBe(404);
    const transformed = await post(`/api/v1/models/${models[0]}/media-operations?assetId=${assets[0]}`, operationBody);
    expect(transformed.status).toBe(202);
    const operation = await transformed.json() as { data: { id: string; state: string } };
    expect(operation.data.state).toBe('queued');
    const transformJobs = await scoped(tx => tx.select({ kind: schema.job.kind }).from(schema.job).where(sql`${schema.job.payload}->>'operationId' = ${operation.data.id}`));
    expect(transformJobs.map(job => job.kind)).toEqual(['media.transform']);
    const scheduleRequest = { platform: 'x', scheduledAt: new Date(Date.now() + 600_000).toISOString() };
    const stageBody = { modelId: models[0], assetId: assets[0], captions: { x: 'A ceramic vase' }, state: 'approved', tosReport: { verdict: 'pass' }, scheduleRequest };
    expect((await post('/api/v1/bundles', { ...stageBody, scheduleRequest: { ...scheduleRequest, scheduledAt: '2020-01-01T00:00:00Z' } })).status).toBe(400);
    expect((await post('/api/v1/bundles', { ...stageBody, scheduleRequest: { ...scheduleRequest, platform: 'instagram' } })).status).toBe(404);
    expect((await post('/api/v1/bundles', { ...stageBody, modelId: models[1], assetId: assets[1] })).status).toBe(404);
    expect((await post('/api/v1/bundles', { ...stageBody, assetId: assets[1] })).status).toBe(404);
    const staged = await post('/api/v1/bundles', stageBody);
    expect(staged.status).toBe(201);
    const stageResult = await staged.json() as { data: { id: string; state: string; tosReport: { verdict: string }; publishIntent: unknown } };
    bundles.push(stageResult.data.id);
    expect(stageResult.data.state).toBe('generated');
    expect(stageResult.data.tosReport.verdict).toBe('pending');
    expect(stageResult.data.publishIntent).toEqual({ action: 'schedule', ...scheduleRequest });
    const stagedJobs = await scoped(tx => tx.select({ kind: schema.job.kind }).from(schema.job).where(sql`${schema.job.payload}->>'bundleId' = ${stageResult.data.id}`));
    expect(stagedJobs.map(job => job.kind)).toEqual(['tos.scan']);
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await post(`/api/v1/models/${models[0]}/generate`, generationBody)).status).toBe(404);
    expect((await post('/api/v1/bundles', stageBody)).status).toBe(404);
  });
});
