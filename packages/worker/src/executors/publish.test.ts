import { afterEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@axiom/db';
import {
  assertProviderReadableMediaUrls,
  isTerminalPublishTargetState,
  publishDispatchMarkerValues,
  publishTarget,
  persistAssistedPublishHandoff,
  publicationMediaOptions,
  resolvePublicationSnapshot,
  buildPublicationSnapshot,
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
  vi.useRealTimers();
});

describe('publication snapshot evidence', () => {
  const original = { caption: 'Original', hashtags: [], modelId: 'model', assetId: null, scheduledFor: null,
    tosReport: { verdict: 'pass', score: 0.1 } };
  const changed = { ...original, caption: 'Edited after dispatch', tosReport: { verdict: 'fail', score: 0.9 } };
  it('captures only a first dispatch', () => {
    expect(resolvePublicationSnapshot({ remoteId: null }, original)).toEqual(original);
  });
  it('preserves first-dispatch evidence on status polling', () => {
    expect(resolvePublicationSnapshot({ remoteId: 'provider-id', publicationSnapshot: original }, changed)).toEqual(original);
  });
  it('does not fabricate a snapshot for an older provider resource', () => {
    expect(resolvePublicationSnapshot({ remoteId: 'provider-id' }, changed)).toBeNull();
  });
  it('captures dispatched media metadata and immutable ToS evidence', () => {
    expect(buildPublicationSnapshot({ ...original, media: {
      kind: 'image', mimeType: 'image/jpeg', width: 864, height: 1152, duration: null,
    }, shootConfig: { style: 'studio', outfit: 'dress', location: 'studio', mood: 'calm', lighting: 'soft', aspectRatio: '4:5' } })).toMatchObject({
      tosReport: { verdict: 'pass' },
      media: { kind: 'image', mimeType: 'image/jpeg', width: 864, height: 1152, duration: null },
      shootConfig: { style: 'studio', outfit: 'dress', location: 'studio', mood: 'calm', lighting: 'soft', aspectRatio: '4:5' },
    });
  });
  it('captures only asset-bound trusted thumbnail evidence', () => {
    const thumbnailFeatures = {
      version: 'vision-analysis-v1' as const,
      source: 'rust_engine' as const,
      assetId: 'asset-1',
      assetSha256: 'a'.repeat(64),
      confidence: 0.91,
      dimensions: { width: 864, height: 1152 },
      avgBrightness: 120,
      colorVariance: 22,
      aspectRatio: 0.75,
    };

    expect(buildPublicationSnapshot({ ...original, assetId: 'asset-1', thumbnailFeatures })).toMatchObject({
      assetId: 'asset-1',
      thumbnailFeatures,
    });
  });
});

describe('publish schedule handoff', () => {
  it.each(['pending', 'canceled'])(
    'honors the locked target state for an already-claimed job: %s',
    async (state) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T18:00:00Z'));
      const target = {
        id: 'target-1',
        state,
        remoteId: null,
        scheduledFor: new Date('2026-09-10T19:00:00Z'),
      };
      const query = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        for: vi.fn().mockResolvedValue([target]),
      };
      const tx = { select: vi.fn().mockReturnValue(query) };
      const markExternalSideEffect = vi.fn();
      const persistSideEffectMarker = vi.fn();
      const result = publishTarget({
        tx,
        job: {
          id: 'job-1',
          org_id: 'org-1',
          queue: 'publish',
          kind: 'publish.target',
          payload: { targetId: target.id },
          state: 'running',
          attempts: 0,
          max_attempts: 8,
          last_error: null,
          run_after: new Date(),
          locked_by: 'worker-1',
          locked_at: new Date(),
          dedupe_key: null,
          scheduled_for: null,
          started_at: new Date(),
          completed_at: null,
          created_at: new Date(),
        },
        workerId: 'worker-1',
        killSwitchEnabled: false,
        markExternalSideEffect,
        persistSideEffectMarker,
      });
      if (state === 'canceled') {
        await expect(result).resolves.toBeUndefined();
      } else {
        await expect(result).rejects.toMatchObject({ name: 'ParkJobError', delayMs: 3_600_000 });
      }
      expect(query.for).toHaveBeenCalledWith('update');
      expect(tx.select).toHaveBeenCalledTimes(1);
      expect(markExternalSideEffect).not.toHaveBeenCalled();
      expect(persistSideEffectMarker).not.toHaveBeenCalled();
    },
  );
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

describe('publicationMediaOptions', () => {
  it('passes stored Snap video metadata to the connector boundary for eligibility checks', () => {
    expect(publicationMediaOptions('snapchat', {
      kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 30,
    })).toEqual({
      mediaType: 'video', mediaMimeType: 'video/mp4', mediaWidth: 1080,
      mediaHeight: 1920, mediaDurationSeconds: 30,
    });
  });

  it('keeps provider-specific metadata off unrelated connector contracts', () => {
    expect(publicationMediaOptions('instagram', {
      kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 30,
    })).toEqual({ mediaType: 'video' });
    expect(publicationMediaOptions('snapchat', undefined)).toEqual({});
  });
});

describe('isTerminalPublishTargetState', () => {
  it('treats published, skipped, manual-assist, and canceled targets as terminal', () => {
    expect(isTerminalPublishTargetState('published')).toBe(true);
    expect(isTerminalPublishTargetState('skipped')).toBe(true);
    expect(isTerminalPublishTargetState('manual_assist')).toBe(true);
    expect(isTerminalPublishTargetState('canceled')).toBe(true);
    expect(isTerminalPublishTargetState('pending')).toBe(false);
    expect(isTerminalPublishTargetState('failed')).toBe(false);
  });
});

describe('persistAssistedPublishHandoff', () => {
  it('stores Snapchat manual instructions as a disabled, idempotent model-scoped Relay card', async () => {
    const insert = { values: vi.fn().mockReturnThis(), onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
    const tx = { insert: vi.fn().mockReturnValue(insert) };
    await persistAssistedPublishHandoff(tx, {
      orgId: 'org-1', modelId: 'model-1', bundleId: 'bundle-1', targetId: 'target-1',
      handoff: {
        platform: 'snapchat', type: 'assisted_publish', instructions: 'Open Snapchat and share.',
        assets: ['https://media.example.test/story.jpg'], caption: 'Story caption',
        handoffUrl: 'https://www.snapchat.com/add/creator',
      },
    });
    expect(tx.insert).toHaveBeenCalledWith(schema.relayCard);
    expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', modelId: 'model-1', bundleId: 'bundle-1', channel: 'manual-assist',
      externalRef: 'target-1', state: 'pending', enabled: false,
      config: { snapchatManualAssist: expect.objectContaining({ caption: 'Story caption', assets: ['https://media.example.test/story.jpg'] }) },
    }));
    expect(insert.onConflictDoNothing).toHaveBeenCalledOnce();
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

describe('publishDispatchMarkerValues', () => {
  it('keeps the durable reconciliation marker free of publish content and secrets', () => {
    const startedAt = new Date('2026-09-09T19:00:00.000Z');

    expect(
      publishDispatchMarkerValues('org-1', 'model-1', 'target-1', 'instagram', 'idem-1', startedAt),
    ).toEqual({
      orgId: 'org-1',
      modelId: 'model-1',
      targetId: 'target-1',
      script: 'publish.dispatch',
      status: 'pending',
      input: { platform: 'instagram', idempotencyKey: 'idem-1' },
      startedAt,
    });
  });
});
