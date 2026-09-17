import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { inArray, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { teamOperationsRouter } from './team-operations.js';

const url = process.env.TEST_DATABASE_URL, orgId = '11111111-1111-4111-8111-111111111111';
const models = [randomUUID(), randomUUID()], bundles = [randomUUID(), randomUUID()], posts = [randomUUID(), randomUUID()];
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const scoped = <T>(operation: (tx: Transaction) => Promise<T>, org = orgId) => db.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${org}, true)`); return operation(tx);
});
function app(org = orgId) {
  const route = new Hono<AppBindings>();
  route.use('*', async (c, next) => { c.set('orgId', org); c.set('userId', 'fixture-operator'); await next(); });
  route.route('/', teamOperationsRouter); return route;
}
const path = `/models/${models[0]}/team-notes`;
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
    await scoped(async tx => {
      await tx.insert(schema.modelProfile).values(models.map(id => ({ id, orgId, displayName: 'Team fixture', handle: id })));
      for (let i = 0; i < 2; i++) {
        await tx.insert(schema.contentBundle).values({ id: bundles[i], orgId, modelId: models[i], captions: { x: 'Test' } });
        await tx.insert(schema.postTarget).values({ id: posts[i], orgId, bundleId: bundles[i], platform: 'x', state: 'pending', idemKey: Buffer.from(randomUUID()) });
      }
    });
  });
  afterAll(async () => {
    await scoped(async tx => {
      await tx.delete(schema.postTarget).where(inArray(schema.postTarget.id, posts));
      await tx.delete(schema.contentBundle).where(inArray(schema.contentBundle.id, bundles));
      await tx.delete(schema.modelProfile).where(inArray(schema.modelProfile.id, models));
    });
    await pool.end();
  });
  it('persists a post-linked note with the authenticated author', async () => {
    const result = await write(posts[0]); expect(result.status).toBe(201);
    const { data } = await result.json() as { data: Page['data'][number] };
    expect(data).toMatchObject({ targetId: posts[0], authorUserId: 'fixture-operator', body: 'Post handoff context' });
    const read = await app().request(`${path}?postId=${posts[0]}`);
    expect((await read.json() as Page).data.map(row => row.id)).toContain(data.id);
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
});
