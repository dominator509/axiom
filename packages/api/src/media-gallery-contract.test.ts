// ─── Media gallery lifecycle tests ────────────────────────────────────────
//
// Pure tests: no R2, no storage, no provider, no deployment. Deployed media
// playback remains unclaimed.

import { describe, expect, it } from 'vitest';
import {
  buildGalleryGraph,
  buildGalleryRefresh,
  canRetryMediaOperation,
  claimMediaRetry,
  encodeFilterToken,
  galleryPresentation,
  isSafeGalleryItem,
  isSafePreviewRef,
  matchesFilter,
  normalizeMediaStatus,
  paginateGallery,
  type GalleryItem,
} from './media-gallery-contract.js';

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    assetId: 'asset-1',
    kind: 'image',
    origin: 'uploaded',
    status: 'completed',
    resultAssetIds: [],
    createdAt: '2026-03-01T00:00:00Z',
    previewRef: 'previews/asset-1.webp',
    ...overrides,
  };
}

describe('media gallery lifecycle status truthfulness', () => {
  it('normalizes known statuses', () => {
    for (const status of ['queued', 'running', 'failed', 'completed', 'unknown'] as const) {
      expect(normalizeMediaStatus(status)).toBe(status);
    }
  });

  it('never presents an unrecognized or missing status as completed', () => {
    expect(normalizeMediaStatus('weird')).toBe('unknown');
    expect(normalizeMediaStatus(undefined)).toBe('unknown');
    expect(normalizeMediaStatus(null)).toBe('unknown');
    expect(normalizeMediaStatus(42)).toBe('unknown');
    expect(normalizeMediaStatus('unknown')).not.toBe('completed');
  });
});

describe('media gallery preview descriptor safety', () => {
  it('accepts opaque relative preview refs', () => {
    expect(isSafePreviewRef('previews/a.webp')).toBe(true);
    expect(isSafePreviewRef('v1/thumbs/asset-9.jpg')).toBe(true);
  });

  it('rejects absolute, scheme-bearing and traversal refs', () => {
    expect(isSafePreviewRef('/etc/passwd')).toBe(false);
    expect(isSafePreviewRef('https://bucket.example.com/a.png')).toBe(false);
    expect(isSafePreviewRef('file:///tmp/a.png')).toBe(false);
    expect(isSafePreviewRef('~/a.png')).toBe(false);
    expect(isSafePreviewRef('a/../../b.png')).toBe(false);
    expect(isSafePreviewRef('a\\b.png')).toBe(false);
    expect(isSafePreviewRef('a\0b.png')).toBe(false);
    expect(isSafePreviewRef(123)).toBe(false);
  });

  it('rejects credential-bearing query strings', () => {
    expect(isSafePreviewRef('a.png?x-amz-signature=abc')).toBe(false);
    expect(isSafePreviewRef('a.png?token=abc')).toBe(false);
    expect(isSafePreviewRef('a.png?api_key=abc')).toBe(false);
    expect(isSafePreviewRef('a.png?secret=abc')).toBe(false);
  });

  it('rejects gallery items carrying raw paths, credentials or provider errors', () => {
    expect(isSafeGalleryItem(item() as unknown as Record<string, unknown>)).toBe(true);
    expect(isSafeGalleryItem({ ...item(), storageKey: 's3://bucket/key' } as unknown as Record<string, unknown>)).toBe(false);
    expect(isSafeGalleryItem({ ...item(), providerError: 'stack trace' } as unknown as Record<string, unknown>)).toBe(false);
    expect(isSafeGalleryItem({ ...item(), accessKey: 'AKIA' } as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('media gallery source/result relationships', () => {
  it('derives results-by-source and source-by-result both ways', () => {
    const items = [
      item({ assetId: 'src-1', resultAssetIds: ['res-1', 'res-2'] }),
      item({ assetId: 'res-1', origin: 'transformed', sourceAssetId: 'src-1' }),
      item({ assetId: 'res-2', origin: 'generated', sourceAssetId: 'src-1' }),
    ];
    const graph = buildGalleryGraph(items);
    expect(graph.resultsBySource.get('src-1')).toEqual(['res-1', 'res-2']);
    expect(graph.sourceByResult.get('res-1')).toBe('src-1');
    expect(graph.sourceByResult.get('res-2')).toBe('src-1');
  });

  it('does not duplicate a relationship declared on both sides', () => {
    const items = [
      item({ assetId: 'src-1', resultAssetIds: ['res-1'] }),
      item({ assetId: 'res-1', sourceAssetId: 'src-1' }),
    ];
    const graph = buildGalleryGraph(items);
    expect(graph.resultsBySource.get('src-1')).toEqual(['res-1']);
  });
});

describe('media gallery refresh/reconciliation', () => {
  it('counts unknown items and never implies approval or publication', () => {
    const result = buildGalleryRefresh([
      item({ assetId: 'a', status: 'completed' }),
      item({ assetId: 'b', status: 'mystery' }),
      item({ assetId: 'c', status: 'running' }),
    ]);
    expect(result.reconciled).toBe(2);
    expect(result.unknownCount).toBe(1);
    expect(result.impliesApproval).toBe(false);
    expect(result.impliesPublication).toBe(false);
  });
});

describe('media gallery retry and idempotency', () => {
  it('permits retry only for a failed operation with an idempotency key', () => {
    expect(canRetryMediaOperation('failed', 'op-1', 'key-1')).toBe(true);
    expect(canRetryMediaOperation('completed', 'op-1', 'key-1')).toBe(false);
    expect(canRetryMediaOperation('running', 'op-1', 'key-1')).toBe(false);
    expect(canRetryMediaOperation('failed', undefined, 'key-1')).toBe(false);
    expect(canRetryMediaOperation('failed', 'op-1', '')).toBe(false);
  });

  it('claims a retry exactly once so a double-click cannot enqueue twice', () => {
    const seen = new Set<string>();
    expect(claimMediaRetry(seen, 'key-1')).toBe(true);
    expect(claimMediaRetry(seen, 'key-1')).toBe(false);
    expect(claimMediaRetry(seen, '')).toBe(false);
  });
});

describe('media gallery cursor and filter behavior', () => {
  const items: GalleryItem[] = [
    item({ assetId: 'a1', kind: 'image', origin: 'uploaded' }),
    item({ assetId: 'a2', kind: 'video', origin: 'uploaded' }),
    item({ assetId: 'a3', kind: 'image', origin: 'transformed' }),
    item({ assetId: 'a4', kind: 'image', origin: 'generated', status: 'failed' }),
    item({ assetId: 'a5', kind: 'image', origin: 'uploaded' }),
  ];

  it('filters by kind and origin and status independently', () => {
    expect(items.filter((i) => matchesFilter(i, { kind: 'image' }))).toHaveLength(4);
    expect(items.filter((i) => matchesFilter(i, { origin: 'uploaded' }))).toHaveLength(3);
    expect(items.filter((i) => matchesFilter(i, { status: 'failed' }))).toHaveLength(1);
    expect(items.filter((i) => matchesFilter(i, { kind: 'image', origin: 'uploaded' }))).toHaveLength(2);
  });

  it('preserves filters across cursor pagination', () => {
    const page1 = paginateGallery(items, { kind: 'image' }, 2);
    expect(page1.data.map((i) => i.assetId)).toEqual(['a1', 'a3']);
    expect(page1.meta.next_cursor).not.toBeNull();

    const page2 = paginateGallery(items, { kind: 'image' }, 2, page1.meta.next_cursor!);
    expect(page2.data.map((i) => i.assetId)).toEqual(['a4', 'a5']);
    expect(page2.data.every((i) => i.kind === 'image')).toBe(true);
    expect(page2.meta.next_cursor).toBeNull();
  });

  it('rejects a cursor whose filter no longer matches the request', () => {
    const page1 = paginateGallery(items, { kind: 'image' }, 2);
    expect(() => paginateGallery(items, { kind: 'video' }, 2, page1.meta.next_cursor!)).toThrow(/does not match/);
  });

  it('rejects an invalid page size and a malformed cursor', () => {
    expect(() => paginateGallery(items, {}, 0)).toThrow(/invalid gallery page size/);
    expect(() => paginateGallery(items, {}, 101)).toThrow(/invalid gallery page size/);
    // A cursor from a different filter is refused before its id is resolved.
    expect(() => paginateGallery(items, {}, 2, 'k=image|missing-id')).toThrow(/does not match/);
    // A cursor carrying the requested filter but an unknown id is refused.
    expect(() => paginateGallery(items, {}, 2, '|missing-id')).toThrow(/invalid gallery cursor/);
  });

  it('encodes a stable filter token', () => {
    expect(encodeFilterToken({ kind: 'image', origin: 'uploaded' })).toBe('k=image&o=uploaded');
    expect(encodeFilterToken({})).toBe('');
  });
});

describe('media gallery responsive states', () => {
  it('reports loading, empty, error and ready distinctly', () => {
    expect(galleryPresentation([], { loading: true }).state).toBe('loading');
    expect(galleryPresentation([], {}).state).toBe('empty');
    expect(galleryPresentation([], { error: 'boom' }).state).toBe('error');
    expect(galleryPresentation([item()], {}).state).toBe('ready');
  });

  it('never presents a partially failed gallery as a clean success', () => {
    const presentation = galleryPresentation([item({ assetId: 'a', status: 'completed' }), item({ assetId: 'b', status: 'failed' })]);
    expect(presentation.state).toBe('partial');
    expect(presentation.message).toContain('failed');
    expect(presentation.state).not.toBe('ready');
  });

  it('treats an unknown status as not-yet-ready rather than a failure claim', () => {
    const presentation = galleryPresentation([item({ assetId: 'a', status: 'mystery' })]);
    expect(presentation.state).toBe('ready');
  });
});
