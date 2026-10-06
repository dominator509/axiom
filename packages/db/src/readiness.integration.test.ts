import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assertDatabaseReady } from './readiness.js';

// Only the explicitly selected local disposable harness may perform DDL here.
// Every mutation is transactionally rolled back; no configured recovery URL is used.
const enabled = process.env.AXIOM_READINESS_FIXTURE === '1';
describe.skipIf(!enabled)('readiness against real PostgreSQL catalog and runtime role', () => {
  const container = 'axiom-ci-local-6cefdc1';
  function queryAfter(setup: string) {
    return {
      async query(text: string, values: string[]) {
        const url = new URL(process.env.TEST_DATABASE_URL!);
        expect(url.hostname).toBe('127.0.0.1');
        expect(url.port).toBe('55432');
        const database = url.pathname.slice(1);
        expect(database).toMatch(/^axiom_workspace_test_[0-9a-f]{16}$/);
        const inspected = spawnSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container],
          { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
        expect(inspected.status).toBe(0);
        expect(JSON.parse(inspected.stdout)['axiom.purpose']).toBe('isolated-ci-validation');
        const literal = `'${values[0].replace(/'/g, "''")}'`;
        const statement = text.replace('$1', literal);
        const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-w', '-qAt',
          '-U', 'axiom', '-d', database, '-v', 'ON_ERROR_STOP=1'], {
          input: `BEGIN; ${setup}\nSET LOCAL ROLE axiom_app;\n${statement};\nROLLBACK;`,
          encoding: 'utf8', windowsHide: true, timeout: 20_000,
        });
        expect(result.status, 'Disposable readiness SQL failed').toBe(0);
        const output = result.stdout.trim();
        expect(['t', 'f']).toContain(output);
        return { rows: [{ ready: output === 't' }] };
      },
    };
  }

  it('accepts the migrated schema as the runtime role without reading tenant rows', async () => {
    await expect(assertDatabaseReady(queryAfter(''))).resolves.toBeUndefined();
  });
  it.each([
    ['empty public schema', 'ALTER SCHEMA public RENAME TO readiness_saved; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO axiom_app;'],
    ['missing table', 'ALTER TABLE public.auth_user RENAME TO readiness_hidden_user;'],
    ['missing column', 'ALTER TABLE public.asset RENAME COLUMN origin TO readiness_hidden_origin;'],
    ['missing SELECT grant', 'REVOKE SELECT ON public.auth_user FROM axiom_app;'],
  ])('rejects %s and leaves the fixture intact', async (_name, setup) => {
    await expect(assertDatabaseReady(queryAfter(setup))).rejects.toThrow('Database schema is not ready');
    await expect(assertDatabaseReady(queryAfter(''))).resolves.toBeUndefined();
  });
});
