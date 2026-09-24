import { describe, expect, it, vi } from 'vitest';
import { claimNextModelMediaJob, resolveMediaWorkerScope } from './claim.js';
const orgId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
describe('explicit media worker scope', () => {
  it('keeps normal worker selection only when neither setting exists', () => {
    expect(resolveMediaWorkerScope({})).toBeUndefined();
    expect(resolveMediaWorkerScope({ WORKER_MEDIA_ORG_ID: orgId, WORKER_MEDIA_MODEL_ID: modelId }))
      .toEqual({ orgId, modelId });
  });
  it.each([
    { WORKER_MEDIA_ORG_ID: orgId }, { WORKER_MEDIA_MODEL_ID: modelId },
    { WORKER_MEDIA_ORG_ID: '', WORKER_MEDIA_MODEL_ID: '' },
    { WORKER_MEDIA_ORG_ID: orgId, WORKER_MEDIA_MODEL_ID: '*' },
  ])('rejects incomplete or broad scope instead of falling back to global claims: %j', env => {
    expect(() => resolveMediaWorkerScope(env)).toThrow('Both valid');
  });
  it('rejects invalid direct scope before database access', async () => {
    const execute = vi.fn();
    await expect(claimNextModelMediaJob({ execute }, 'worker', { orgId, modelId: '*' })).rejects.toThrow('Both valid');
    expect(execute).not.toHaveBeenCalled();
  });
});
