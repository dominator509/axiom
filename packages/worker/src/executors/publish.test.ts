import { describe, expect, it } from 'vitest';
import { validatePublishAsset } from './publish.js';

const asset = {
  id: 'asset-1',
  orgId: 'org-1',
  modelId: 'model-1',
  kind: 'image',
  storageKey: 'models/model-1/image.jpg',
};

describe('validatePublishAsset', () => {
  it('returns the supported media kind for a model-owned asset', () => {
    expect(validatePublishAsset(asset, 'asset-1', 'org-1', 'model-1')).toBe('image');
  });

  it('rejects an asset from another organization or model', () => {
    expect(() => validatePublishAsset(asset, 'asset-1', 'org-2', 'model-1')).toThrow(
      'asset asset-1 is not owned by model model-1',
    );
    expect(() => validatePublishAsset(asset, 'asset-1', 'org-1', 'model-2')).toThrow(
      'asset asset-1 is not owned by model model-2',
    );
  });

  it('rejects media kinds without a publish-plane contract', () => {
    expect(() =>
      validatePublishAsset({ ...asset, kind: 'audio' }, 'asset-1', 'org-1', 'model-1'),
    ).toThrow('unsupported asset kind audio');
  });

  it('allows text-only bundles without an asset', () => {
    expect(validatePublishAsset(undefined, null, 'org-1', 'model-1')).toBeUndefined();
  });
});
