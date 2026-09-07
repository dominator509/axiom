import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertProviderReadableMediaUrls,
  isTerminalPublishTargetState,
  resolveProviderAssetUrl,
  shouldEnqueueMetrics,
  validatePublishAsset,
} from './publish.js';

const asset = {
  id: 'asset-1',
  orgId: 'org-1',
  modelId: 'model-1',
  kind: 'image',
  storageKey: 'models/model-1/image.jpg',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

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

describe('isTerminalPublishTargetState', () => {
  it('treats published and assisted skipped targets as terminal', () => {
    expect(isTerminalPublishTargetState('published')).toBe(true);
    expect(isTerminalPublishTargetState('skipped')).toBe(true);
    expect(isTerminalPublishTargetState('pending')).toBe(false);
    expect(isTerminalPublishTargetState('failed')).toBe(false);
  });
});

describe('assertProviderReadableMediaUrls', () => {
  it('allows provider-facing HTTP(S) URLs and text-only posts', () => {
    expect(() =>
      assertProviderReadableMediaUrls([
        'https://cdn.example.com/photo.jpg',
        'http://cdn.example/video.mp4',
      ]),
    ).not.toThrow();
    expect(() => assertProviderReadableMediaUrls([])).not.toThrow();
  });

  it('rejects internal asset references before connector dispatch', () => {
    expect(() => assertProviderReadableMediaUrls(['asset://asset-1'], 'asset-1')).toThrow(
      'media URL 0 is not provider-readable for asset asset-1; expected an http(s) URL',
    );
  });

  it('rejects malformed and non-HTTP schemes', () => {
    expect(() => assertProviderReadableMediaUrls(['not-a-url'])).toThrow(
      'media URL 0 is not provider-readable',
    );
    expect(() => assertProviderReadableMediaUrls(['file:///var/media/photo.jpg'])).toThrow(
      'expected an http(s) URL',
    );
  });
});

describe('resolveProviderAssetUrl', () => {
  it('maps a tenant-scoped storage key under the configured delivery base', () => {
    vi.stubEnv('AXIOM_ASSET_DELIVERY_BASE_URL', 'https://media.example.test/assets');

    expect(resolveProviderAssetUrl(asset)).toBe(
      'https://media.example.test/assets/models/model-1/image.jpg',
    );
  });

  it('requires an explicit delivery base instead of leaking an internal path', () => {
    vi.stubEnv('AXIOM_ASSET_DELIVERY_BASE_URL', '');

    expect(() => resolveProviderAssetUrl(asset)).toThrow(
      'AXIOM_ASSET_DELIVERY_BASE_URL is required',
    );
  });

  it('requires HTTPS in production and rejects traversal keys', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AXIOM_ASSET_DELIVERY_BASE_URL', 'http://media.example.test/assets/');
    expect(() => resolveProviderAssetUrl(asset)).toThrow('must use https in production');

    vi.stubEnv('AXIOM_ASSET_DELIVERY_BASE_URL', 'https://media.example.test/assets/');
    expect(() => resolveProviderAssetUrl({ ...asset, storageKey: '../private.jpg' })).toThrow(
      'invalid storage key',
    );
  });
});

describe('shouldEnqueueMetrics', () => {
  it('requires both a provider remote id and declared metrics', () => {
    expect(shouldEnqueueMetrics('remote-1', ['likes'])).toBe(true);
    expect(shouldEnqueueMetrics('remote-1', [])).toBe(false);
    expect(shouldEnqueueMetrics(null, ['likes'])).toBe(false);
  });
});
