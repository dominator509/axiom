// ─── Media gallery lifecycle contract (F-media) ───────────────────────────
//
// Read/projection contract over EXISTING asset, asset_variant, media_operation
// and content_bundle state. No parallel gallery or storage model is introduced,
// and no raw storage path, credential or provider error is ever exposed.
//
// This module is pure: it decides shape, status truthfulness, preview safety,
// filter-preserving pagination and retry eligibility. It performs no I/O.

export type MediaKind = 'image' | 'video';
export type MediaOrigin = 'uploaded' | 'generated' | 'transformed';
export type MediaOperationStatus = 'queued' | 'running' | 'failed' | 'completed' | 'unknown';

/** Canonical lifecycle states a gallery card may display. */
export const MEDIA_STATUSES: MediaOperationStatus[] = ['queued', 'running', 'failed', 'completed', 'unknown'];

/**
 * Normalize any stored/legacy status into a display state. An unrecognized or
 * missing value becomes 'unknown' — it is never silently shown as 'completed'.
 */
export function normalizeMediaStatus(raw: unknown): MediaOperationStatus {
  return typeof raw === 'string' && (MEDIA_STATUSES as readonly string[]).includes(raw)
    ? (raw as MediaOperationStatus)
    : 'unknown';
}

export interface GalleryItem {
  assetId: string;
  kind: MediaKind;
  origin: MediaOrigin;
  status: string;
  /** Present when this item was produced by a media operation. */
  operationId?: string;
  /** The source asset for a transformed/generated result. */
  sourceAssetId?: string;
  /** Result assets produced from this source. */
  resultAssetIds: string[];
  createdAt: string;
  /** Opaque storage reference. Never a raw bucket path or credential. */
  previewRef?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

/**
 * Preview descriptor safety: a preview reference must be opaque and relative —
 * no scheme, no absolute path, no traversal, no credential-bearing query.
 */
export function isSafePreviewRef(ref: unknown): ref is string {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 512) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false; // scheme:// or scheme:
  if (ref.startsWith('/') || ref.startsWith('~') || ref.includes('..')) return false;
  if (ref.includes('\\') || ref.includes('\0') || ref.includes('\n')) return false;
  if (/[?&](x-amz-signature|signature|token|key|secret|credential|api[_-]?key)=/i.test(ref)) return false;
  return true;
}

/** A gallery item must never carry raw paths, credentials or provider errors. */
const FORBIDDEN_ITEM_FIELDS = [
  'storageKey',
  'rawPath',
  'bucket',
  'accessKey',
  'secretKey',
  'credential',
  'providerError',
  'stack',
];

export function isSafeGalleryItem(item: Record<string, unknown>): boolean {
  for (const field of FORBIDDEN_ITEM_FIELDS) {
    if (field in item) return false;
  }
  const serialized = JSON.stringify(item);
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(serialized) && item.previewRef !== undefined) {
    // A URL-bearing previewRef is the only permitted place a scheme could appear,
    // and even then it must be rejected by isSafePreviewRef.
    if (typeof item.previewRef === 'string' && /[a-z][a-z0-9+.-]*:/i.test(item.previewRef)) return false;
  }
  return true;
}

/**
 * Retry eligibility: only a failed operation may be retried, and only with an
 * idempotency key so a double-click cannot enqueue two operations.
 */
export function canRetryMediaOperation(
  status: string,
  operationId: string | undefined,
  idempotencyKey: string | undefined,
): boolean {
  if (normalizeMediaStatus(status) !== 'failed') return false;
  if (!operationId || typeof operationId !== 'string') return false;
  return typeof idempotencyKey === 'string' && idempotencyKey.length > 0;
}

/** Claim a retry intent exactly once. */
export function claimMediaRetry(seen: Set<string>, idempotencyKey: string): boolean {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) return false;
  if (seen.has(idempotencyKey)) return false;
  seen.add(idempotencyKey);
  return true;
}

/** Refresh/reconciliation must never itself imply approval or publication. */
export interface GalleryRefreshResult {
  items: GalleryItem[];
  reconciled: number;
  unknownCount: number;
  impliesApproval: false;
  impliesPublication: false;
}

export function buildGalleryRefresh(items: GalleryItem[]): GalleryRefreshResult {
  return {
    items,
    reconciled: items.filter((item) => normalizeMediaStatus(item.status) !== 'unknown').length,
    unknownCount: items.filter((item) => normalizeMediaStatus(item.status) === 'unknown').length,
    impliesApproval: false,
    impliesPublication: false,
  };
}

/** Source/result relationships derived from existing asset/variant state. */
export interface GalleryGraph {
  /** source asset id -> result asset ids */
  resultsBySource: Map<string, string[]>;
  /** result asset id -> source asset id */
  sourceByResult: Map<string, string>;
}

export function buildGalleryGraph(items: GalleryItem[]): GalleryGraph {
  const resultsBySource = new Map<string, string[]>();
  const sourceByResult = new Map<string, string>();

  for (const item of items) {
    for (const resultId of item.resultAssetIds) {
      const existing = resultsBySource.get(item.assetId) ?? [];
      if (!existing.includes(resultId)) existing.push(resultId);
      resultsBySource.set(item.assetId, existing);
      if (!sourceByResult.has(resultId)) sourceByResult.set(resultId, item.assetId);
    }
    if (item.sourceAssetId) {
      sourceByResult.set(item.assetId, item.sourceAssetId);
      const existing = resultsBySource.get(item.sourceAssetId) ?? [];
      if (!existing.includes(item.assetId)) existing.push(item.assetId);
      resultsBySource.set(item.sourceAssetId, existing);
    }
  }
  return { resultsBySource, sourceByResult };
}

/** Gallery filters that must survive cursor pagination. */
export interface GalleryFilter {
  kind?: MediaKind;
  origin?: MediaOrigin;
  status?: MediaOperationStatus;
}

export function matchesFilter(item: GalleryItem, filter: GalleryFilter): boolean {
  if (filter.kind && item.kind !== filter.kind) return false;
  if (filter.origin && item.origin !== filter.origin) return false;
  if (filter.status && normalizeMediaStatus(item.status) !== filter.status) return false;
  return true;
}

/** Encode a filter into a stable cursor prefix so a page cannot drift filters. */
export function encodeFilterToken(filter: GalleryFilter): string {
  const parts: string[] = [];
  if (filter.kind) parts.push(`k=${filter.kind}`);
  if (filter.origin) parts.push(`o=${filter.origin}`);
  if (filter.status) parts.push(`s=${filter.status}`);
  return parts.join('&');
}

export interface GalleryPage {
  data: GalleryItem[];
  meta: { next_cursor: string | null; filter: string };
}

/**
 * Bounded page over filtered items. The cursor carries the filter token so
 * following pages cannot silently change kind/origin/status scope.
 */
export function paginateGallery(
  items: GalleryItem[],
  filter: GalleryFilter,
  pageSize = 24,
  cursor?: string,
): GalleryPage {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('invalid gallery page size');
  }
  const filterToken = encodeFilterToken(filter);

  if (cursor && typeof cursor === 'string' && cursor.includes('|')) {
    const [cursorFilter] = cursor.split('|');
    if (cursorFilter !== filterToken) {
      throw new Error('cursor filter does not match requested filter');
    }
  }

  const filtered = items.filter((item) => matchesFilter(item, filter));
  const startIndex = cursor && cursor.includes('|')
    ? (() => {
      const lastId = cursor.split('|')[1];
      const idx = filtered.findIndex((item) => item.assetId === lastId);
      return idx === -1 ? -1 : idx + 1;
    })()
    : 0;
  if (startIndex === -1) throw new Error('invalid gallery cursor');

  const slice = filtered.slice(startIndex, startIndex + pageSize + 1);
  const hasMore = slice.length > pageSize;
  const data = slice.slice(0, pageSize);
  return {
    data,
    meta: {
      next_cursor: hasMore ? `${filterToken}|${data[data.length - 1].assetId}` : null,
      filter: filterToken,
    },
  };
}

/**
 * Truthful empty/error presentation. An empty or partially-failed gallery is
 * never presented as a successful, complete result.
 */
export interface GalleryPresentation {
  state: 'loading' | 'empty' | 'error' | 'ready' | 'partial';
  message: string;
}

export function galleryPresentation(
  items: GalleryItem[],
  opts: { loading?: boolean; error?: string } = {},
): GalleryPresentation {
  if (opts.loading) return { state: 'loading', message: 'Loading media…' };
  if (opts.error) return { state: 'error', message: opts.error };
  if (items.length === 0) return { state: 'empty', message: 'No media yet.' };
  const failed = items.filter((item) => normalizeMediaStatus(item.status) === 'failed').length;
  if (failed > 0) return { state: 'partial', message: `${failed} item(s) failed to process.` };
  return { state: 'ready', message: '' };
}
