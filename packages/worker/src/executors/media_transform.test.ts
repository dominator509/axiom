import { expect, it, vi } from 'vitest';
import { confirmTransformOutput, mediaTransform } from './media_transform.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from '@axiom/db';
const output = 'operations/example.mp4';
it.each([true, false])('requires real persisted output before creating a linked library asset: file exists %s', async exists => {
  const root = await mkdtemp(join(tmpdir(), 'axiom-transform-output-'));
  const id = '11111111-1111-4111-8111-111111111111';
  const bytes = Buffer.from([255, 216, 255, ...Array(20).fill(7)]);
  const inserts: Array<{ table: unknown; values: any }> = [];
  const selections = [{ id, modelId: id, sourceAssetId: id, type: 'image_resize', state: 'queued', options: { width: 20, height: 30 } },
    { id, kind: 'image', storageKey: 'source.jpg' }];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [selections.shift()] }) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: (table: unknown) => ({ values: (values: any) => {
      inserts.push({ table, values });
      const returning = async () => [{ id, ...values }];
      return { returning, onConflictDoNothing: () => ({ returning }) };
    } }),
  };
  vi.stubEnv('AXIOM_MEDIA_ROOT', root);
  vi.stubEnv('MEDIA_PLANE_AUTH_TOKEN', 'isolated-test-token');
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    if (exists) { await mkdir(join(root, 'operations')); await writeFile(join(root, body.output_path), bytes); }
    return Response.json({ status: 'ok', output_path: body.output_path });
  }));
  try {
    const result = mediaTransform({ tx, job: { org_id: id, payload: { operationId: id } } } as any);
    if (!exists) { await expect(result).rejects.toThrow(); expect(inserts).toEqual([]); return; }
    await result;
    const asset = inserts.find(row => row.table === schema.asset)!.values;
    const variant = inserts.find(row => row.table === schema.assetVariant)!.values;
    expect(asset).toMatchObject({ orgId: id, modelId: id, origin: 'transformed', mimeType: 'image/jpeg', fileSize: bytes.length });
    expect(asset.nsfwRating).toBeUndefined();
    expect(await readFile(join(root, asset.storageKey))).toEqual(bytes);
    expect(variant).toMatchObject({ outputAssetId: id, assetId: id, storageKey: asset.storageKey });
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
it('accepts the media-plane output receipt', async () => {
  await expect(confirmTransformOutput(Response.json({ status: 'ok', output_path: output }), output)).resolves.toBeUndefined();
});
it.each([{}, null, [], { status: 'pending', output_path: output }, { status: 'ok', output_path: 'another.mp4' }])('rejects unconfirmed output %#', async receipt => {
  await expect(confirmTransformOutput(Response.json(receipt), output)).rejects.toThrow('did not confirm');
});
it('does not echo an invalid response body', async () => {
  await expect(confirmTransformOutput(new Response('private provider body'), output)).rejects.toThrow(/^media plane returned an invalid transform receipt$/);
});
it('bounds receipt consumption and cancels an oversized stream', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20_000)); }, cancel });
  await expect(confirmTransformOutput(new Response(body), output)).rejects.toThrow('maximum supported size');
  expect(cancel).toHaveBeenCalledOnce();
});
it('rejects and cancels failed HTTP responses', async () => {
  const cancel = vi.fn();
  await expect(confirmTransformOutput(new Response(new ReadableStream({ cancel }), { status: 502 }), output)).rejects.toThrow('HTTP 502');
  expect(cancel).toHaveBeenCalledOnce();
});
