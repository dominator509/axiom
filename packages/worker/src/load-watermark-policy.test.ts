import { expect, it, vi } from 'vitest';
import { loadWatermarkPolicy, loadWatermarkTransform } from './load-watermark-policy.js';
import { schema } from '@axiom/db';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const WATERMARK_KEY = `generated/${ORG_ID}/${MODEL_ID}/wm.png`;

function txReturning(rows: unknown[]) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  } as any;
}

it('returns the disabled default when no row exists', async () => {
  const policy = await loadWatermarkPolicy(txReturning([]), ORG_ID, MODEL_ID);
  expect(policy).toEqual({ enabled: false, watermarkKey: null, position: 'bottom-right', opacity: 60, scale: 100 });
});

it('loads a persisted policy as a bounded view', async () => {
  const policy = await loadWatermarkPolicy(
    txReturning([{ enabled: true, watermarkKey: WATERMARK_KEY, position: 'center', opacity: 30, scale: 45 }]),
    ORG_ID,
    MODEL_ID,
  );
  expect(policy).toEqual({ enabled: true, watermarkKey: WATERMARK_KEY, position: 'center', opacity: 30, scale: 45 });
});

it('resolves transform fields only for an enabled, in-range policy', async () => {
  const ok = await loadWatermarkTransform(
    txReturning([{ enabled: true, watermarkKey: WATERMARK_KEY, position: 'top-right', opacity: 55, scale: 80 }]),
    ORG_ID,
    MODEL_ID,
  );
  expect(ok).toEqual({ watermarkKey: WATERMARK_KEY, position: 'top-right', opacity: 55, scale: 80 });

  const disabled = await loadWatermarkTransform(
    txReturning([{ enabled: false, watermarkKey: null, position: 'bottom-right', opacity: 60, scale: 100 }]),
    ORG_ID,
    MODEL_ID,
  );
  expect(disabled).toBeNull();
});

it('fails closed on out-of-range persisted values', async () => {
  for (const row of [
    { enabled: true, watermarkKey: WATERMARK_KEY, position: 'nowhere', opacity: 60, scale: 100 },
    { enabled: true, watermarkKey: WATERMARK_KEY, position: 'center', opacity: 101, scale: 100 },
    { enabled: true, watermarkKey: WATERMARK_KEY, position: 'center', opacity: 60, scale: 4 },
    { enabled: true, watermarkKey: '../escape.png', position: 'center', opacity: 60, scale: 100 },
  ]) {
    expect(await loadWatermarkTransform(txReturning([row]), ORG_ID, MODEL_ID)).toBeNull();
  }
});

it('queries the watermark_policy table for the exact org/model scope', async () => {
  const where = vi.fn(() => ({ limit: async () => [] }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  await loadWatermarkPolicy({ select } as any, ORG_ID, MODEL_ID);
  expect(select).toHaveBeenCalledWith();
  expect(from).toHaveBeenCalledWith(schema.watermarkPolicy);
  expect(where).toHaveBeenCalledTimes(1);
});
