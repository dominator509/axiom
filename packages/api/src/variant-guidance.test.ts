import { describe, expect, it } from 'vitest';
import { captionSha256, projectStoredVariantGuidance, readVerifiedGuidance, sameGuidanceProvenance } from './variant-guidance.js';

const bundleId = '11111111-1111-4111-8111-111111111111';
const text = 'A ceramic vase in soft morning light.';

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: bundleId,
    sourceVariantId: null,
    captions: { instagram: text },
    captionGuidance: {
      instagram: {
        version: 'caption-guidance-v1',
        selectedArm: 'short:question',
        context: 'learn-v1:scheduled-utc-1',
        exemplarIds: [],
        captionSha256: captionSha256(text),
        hookType: 'question',
        format: 'reel',
        postingHourUtc: 9,
        timingBucket: 'morning',
      },
    },
    ...overrides,
  };
}

describe('variant guidance provenance', () => {
  it('accepts a matching server receipt and projects only bounded attribution', () => {
    const result = readVerifiedGuidance(source(), 'instagram', text);
    expect(result?.provenance.captionSha256).toBe(captionSha256(text));
    expect(result?.summary).toMatchObject({
      sourceBundleId: bundleId,
      sourceVariantId: null,
      platform: 'instagram',
      hookType: 'question',
      format: 'reel',
      postingHourUtc: 9,
      timingBucket: 'morning',
    });
    expect(result?.summary).not.toHaveProperty('captionSha256');
    expect(result?.summary).not.toHaveProperty('exemplarIds');
  });

  it('accepts the versioned v2 arm and context without weakening evidence checks', () => {
    const result = readVerifiedGuidance(source({ captionGuidance: { instagram: {
      ...source().captionGuidance.instagram,
      selectedArm: 'v2:short:statement:hook=question:format=reel',
      context: 'learn-v2:scheduled-utc-1',
    } } }), 'instagram', text);
    expect(result?.provenance).toMatchObject({ selectedArm: 'v2:short:statement:hook=question:format=reel', context: 'learn-v2:scheduled-utc-1' });
  });

  it('rejects edited text, wrong hashes, malformed evidence, and inconsistent timing', () => {
    expect(readVerifiedGuidance(source(), 'instagram', 'Edited copy')).toBeNull();
    expect(readVerifiedGuidance(source({ captionGuidance: { instagram: {
      ...source().captionGuidance.instagram, captionSha256: '0'.repeat(64),
    } } }), 'instagram', text)).toBeNull();
    expect(readVerifiedGuidance(source({ captionGuidance: { instagram: {
      ...source().captionGuidance.instagram, hookType: 'not-a-hook',
    } } }), 'instagram', text)).toBeNull();
    expect(readVerifiedGuidance(source({ captionGuidance: { instagram: {
      ...source().captionGuidance.instagram, postingHourUtc: 9, timingBucket: 'night',
    } } }), 'instagram', text)).toBeNull();
  });

  it('keeps unknown optional fields unknown and rejects untrusted stored shapes', () => {
    const raw = source();
    raw.captionGuidance.instagram = {
      version: 'caption-guidance-v1', selectedArm: null, context: 'learn-v1:scheduled-utc-unknown',
      exemplarIds: [], captionSha256: captionSha256(text),
    } as unknown as typeof raw.captionGuidance.instagram;
    const result = readVerifiedGuidance(raw, 'instagram', text);
    expect(result?.summary).toMatchObject({ selectedArm: null, sourceVariantId: null });
    expect(result?.summary).not.toHaveProperty('hookType');
    expect(projectStoredVariantGuidance({ guidance: result?.provenance })).toEqual(result?.summary);
    expect(projectStoredVariantGuidance({ guidance: { sourceBundleId: bundleId, platform: 'instagram' } })).toBeNull();
  });

  it('compares the full persisted fingerprint before reusing provenance', () => {
    const result = readVerifiedGuidance(source(), 'instagram', text)!;
    expect(sameGuidanceProvenance(result.provenance, result.provenance)).toBe(true);
    expect(sameGuidanceProvenance({ ...result.provenance, sourceBundleId: 'other' }, result.provenance)).toBe(false);
    expect(sameGuidanceProvenance({ ...result.provenance, captionSha256: '0'.repeat(64) }, result.provenance)).toBe(false);
  });
});
