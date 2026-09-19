import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { playbookGuidelinesRouter } from './playbook-guidelines.js';

const url = process.env.TEST_DATABASE_URL;
const orgId = '11111111-1111-4111-8111-111111111111', modelId = randomUUID();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const scoped = <T>(operation: (tx: Transaction) => Promise<T>) => db.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`); return operation(tx);
});
function app(org = orgId) {
  const route = new Hono<AppBindings>();
  route.use('*', async (c, next) => { c.set('orgId', org); await next(); });
  route.route('/', playbookGuidelinesRouter); return route;
}
const path = `/models/${modelId}/playbook-guidelines`;
const save = (strategy: string, expectedRevision: number) => app().request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision, platform: 'instagram', optimalTimes: ['18:00'], cadencePerWeek: 3, upsellStrategy: strategy }) });
describe.skipIf(!url)('playbook history in PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    expect(process.env.DATABASE_URL).toBe(url);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.username).toBe('axiom_app');
    expect(target.pathname).toMatch(/^\/(?:axiom_test|axiom_workspace_test_[0-9a-f]{16})$/);
    const role = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await scoped(tx => tx.insert(schema.modelProfile).values({ id: modelId, orgId, displayName: 'History fixture', handle: modelId }));
  });
  afterAll(async () => {
    await scoped(tx => tx.delete(schema.modelProfile).where(eq(schema.modelProfile.id, modelId)));
    await pool.end();
  });
  it('preserves both concurrent saves in serial revision order', async () => {
    expect((await save('first', 0)).status).toBe(200);
    const responses = await Promise.all([save('second', 1), save('third', 1)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await save('reviewed', 2)).status).toBe(200);
    const response = await app().request(`${path}?history=true&platform=instagram`);
    const body = await response.json() as { data: { revision: number; upsellStrategy: string }[]; meta: unknown };
    expect(body.data.map(row => row.revision)).toEqual([3, 2, 1]);
    expect(body.data[0].upsellStrategy).toBe('reviewed');
    expect(['second', 'third']).toContain(body.data[1].upsellStrategy);
    expect(body.data[2].upsellStrategy).toBe('first');
    expect(body.meta).toEqual({ next_cursor: null });
  });
  it('bounds history by cursor and platform and excludes another tenant', async () => {
    const older = await app().request(`${path}?history=true&platform=instagram&before=2`);
    expect(await older.json()).toMatchObject({ data: [{ revision: 1 }] });
    expect(await (await app().request(`${path}?history=true&platform=threads`)).json()).toMatchObject({ data: [] });
    expect(await (await app(randomUUID()).request(`${path}?history=true&platform=instagram`)).json()).toMatchObject({ data: [] });
    expect((await app().request(`${path}?history=true&platform=instagram&before=-1`)).status).toBe(400);
  });
  it('denies application-role history overwrite', async () => {
    await expect(scoped(tx => tx.execute(sql`UPDATE playbook_guideline_revision SET upsell_strategy='tampered' WHERE model_id=${modelId}`))).rejects.toThrow();
  });
});
