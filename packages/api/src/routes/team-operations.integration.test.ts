import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import { requireMutationRole } from '@axiom/auth';
import type { AppBindings } from '../index.js';
import { teamOperationsRouter } from './team-operations.js';
import { modelAssignmentsRouter } from './model-assignments.js';
import { modelsRouter } from './models.js';
import { bundlesRouter } from './bundles.js';
import { mediaUploadRouter } from './media-upload.js';
import { fansRouter } from './fans.js';
import { generateRouter } from './generate.js';
import { mediaOperationsRouter } from './media-operations.js';
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
function scopedApp(role: ScopedHumanRole, org = orgId) {
  const route = new Hono<AppBindings>();
  route.use('*', async (c, next) => { c.set('orgId', org); c.set('userId', assignmentUsers[0]); c.set('role', role); await next(); });
  route.use('/api/v1/*', enforceModelAccess);
  route.use('/api/v1/*', requireMutationRole('owner', 'manager', 'operator', 'content_creator'));
  route.route('/api/v1/models', modelsRouter);
  route.route('/api/v1/bundles', bundlesRouter);
  route.route('/api/v1', mediaUploadRouter);
  route.route('/api/v1', fansRouter);
  route.route('/api/v1', generateRouter);
  route.route('/api/v1', mediaOperationsRouter);
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
    expect((await route.request(`/api/v1/fans/${fanIds[1]}`)).status).toBe(404);
    expect((await scopedApp(role, foreignOrg).request(path)).status).toBe(404);
    expect((await scopedApp('content_creator').request(path)).status).toBe(403);
    const listed = await (await route.request(`/api/v1/models/${models[0]}/fans`)).json() as { data: { id: string }[] };
    expect(listed.data.map(row => row.id)).toContain(fanIds[0]);
    expect(listed.data.map(row => row.id)).not.toContain(fanIds[1]);
    if (role === 'chatter') {
      await scoped(tx => tx.update(schema.teamShift).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(schema.teamShift.id, shiftId)));
      expect((await route.request(path)).status).toBe(404);
    }
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await route.request(path)).status).toBe(404);
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
    await scoped(tx => tx.delete(schema.modelUserAssignment).where(eq(schema.modelUserAssignment.userId, assignmentUsers[0])));
    expect((await post(`/api/v1/models/${models[0]}/generate`, generationBody)).status).toBe(404);
  });
});
