// Live end-to-end probe for the egress config API (L2.6 M6).
// Mounts the REAL egress router with org context middleware against the
// REAL axiom_dev DB + REAL egress plane (:3000), then exercises:
//   create (with creds -> plane encrypt) -> list -> get -> update ->
//   plane bind/status -> delete
// Run from packages/api with the repo .env loaded (dotenv resolves ../../../.env).

import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Minimal .env loader (dotenv is not a direct dep of @axiom/api).
const envPath = path.resolve(__dirname, '../../../../.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const { egressRouter } = await import('../routes/egress.js');

const ORG_ID = '00000000-0000-0000-0000-000000000000';
const MODEL_ID = '9283b927-b95d-461c-90d0-729bc2d13852';

const app = new Hono();
app.use('*', async (c, next) => {
  (c as any).set('orgId', ORG_ID);
  await next();
});
app.route('/', egressRouter);

async function main() {
  const results: string[] = [];

  // 1. Create a socks5 config with credentials (plane-encrypted at rest)
  const createRes = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId: MODEL_ID,
      egressMode: 'socks5',
      proxyAddr: '127.0.0.1:1080',
      proxyUsername: 'liveprobe',
      proxyPassword: 'live-s3cret',
      expectedEgressIp: '203.0.113.7',
    }),
  });
  results.push(`create: ${createRes.status}`);
  const created = (await createRes.json()) as any;
  if (createRes.status !== 201) {
    console.log(results.join('\n'));
    console.log(JSON.stringify(created, null, 2));
    process.exit(1);
  }
  const configId = created.data.id;
  results.push(
    `  id=${configId} mode=${created.data.egressMode} credsStripped=${!('encCreds' in created.data)}`,
  );

  // 2. List — row must be visible under the org context
  const listRes = await app.request('/');
  const list = (await listRes.json()) as any;
  results.push(
    `list: ${listRes.status} total=${list.meta.total} match=${list.data.some((r: any) => r.id === configId)}`,
  );

  // 3. Get single
  const getRes = await app.request(`/${configId}`);
  const got = (await getRes.json()) as any;
  results.push(`get: ${getRes.status} mode=${got.data?.egressMode}`);

  // 4. Verify the envelope is really stored encrypted in Postgres (not plaintext)
  const { db, schema } = await import('@axiom/db');
  const rows = await db.transaction(async (tx: any) => {
    await tx.execute(
      await import('drizzle-orm').then(
        (m) => m.sql`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`,
      ),
    );
    return tx
      .select()
      .from(schema.modelNetworkConfigs)
      .where((await import('drizzle-orm')).eq(schema.modelNetworkConfigs.id, configId));
  });
  const row = rows[0] as any;
  const storedEnc = row.encCreds ? Buffer.from(row.encCreds as Uint8Array).length : 0;
  results.push(
    `db: enc_creds_bytes=${storedEnc} enc_nonce_bytes=${row.encNonce ? Buffer.from(row.encNonce as Uint8Array).length : 0} dek_id=${row.dekId}`,
  );

  // 5. Update (no creds) — must not hit the plane
  const updRes = await app.request(`/${configId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ egressMode: 'http', proxyAddr: '127.0.0.1:8080' }),
  });
  results.push(`update: ${updRes.status} mode=${((await updRes.json()) as any).data?.egressMode}`);

  // 6. Plane proxy: bind this model through the API
  const bindRes = await app.request('/plane/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: MODEL_ID, mode: 'http', proxy_addr: '127.0.0.1:8080' }),
  });
  const bind = (await bindRes.json()) as any;
  results.push(`plane/bind: ${bindRes.status} ${JSON.stringify(bind.data ?? bind.error ?? {})}`);

  // 7. Plane proxy: status
  const statusRes = await app.request('/plane/status');
  const status = (await statusRes.json()) as any;
  results.push(`plane/status: ${statusRes.status} count=${status.data?.count}`);

  // 8. Plane proxy: health
  const healthRes = await app.request('/plane/health');
  results.push(`plane/health: ${healthRes.status}`);

  // 9. Cleanup: delete the config
  const delRes = await app.request(`/${configId}`, { method: 'DELETE' });
  results.push(`delete: ${delRes.status} ${JSON.stringify((await delRes.json()) as any)}`);

  console.log(results.join('\n'));
}

main().catch((err) => {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
});
