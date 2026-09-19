import Link from 'next/link';
import { api } from '@/lib/api';
import BundleMedia from '@/components/BundleMedia';
import MediaOperationControls from '@/components/MediaOperationControls';
import MediaBundleCreate from '@/components/MediaBundleCreate';
import CopyVariantCreate from '@/components/CopyVariantCreate';
import MediaUpload from '@/components/MediaUpload';
import { getSession, type MediaKind, type MediaOrigin } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';
const MEDIA_ORIGINS: readonly MediaOrigin[] = ['uploaded', 'generated', 'transformed', 'legacy'];
const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video'];
type MediaAsset = Awaited<ReturnType<typeof api.models.media>>['data'][number];

function assetTitle(asset: MediaAsset): string {
  if (asset.origin === 'uploaded') return 'Uploaded source';
  if (asset.origin === 'generated') return 'Generated media';
  if (asset.origin === 'transformed') return 'Transformed media';
  return 'Saved';
}

function lifecyclePresentation(asset: MediaAsset): { label: string; tone: 'good' | 'warn' | 'bad' | 'mute'; detail: string } {
  if (!asset.operationId) return { label: 'Saved', tone: 'mute', detail: 'Stored media; no transform operation is attached.' };
  switch (asset.status) {
    case 'queued': return { label: 'Queued', tone: 'warn', detail: 'Waiting for the media worker.' };
    case 'running': return { label: 'Processing', tone: 'warn', detail: 'The media worker is processing this operation.' };
    case 'failed': return { label: 'Transform failed', tone: 'bad', detail: 'The operation failed; inspect the transform history before retrying.' };
    case 'completed': return { label: 'Transform complete', tone: 'good', detail: 'The result is saved, but still requires its own review.' };
    default: return { label: 'Status unavailable', tone: 'mute', detail: 'Refresh status before taking another action.' };
  }
}

function shortAssetId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function mediaHref(base: string, cursor: string | undefined, origin: MediaOrigin | undefined, kind: MediaKind | undefined): string {
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  if (origin) query.set('origin', origin);
  if (kind) query.set('kind', kind);
  const suffix = query.toString();
  return `${base}/media${suffix ? `?${suffix}` : ''}`;
}

export default async function MediaPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  const origin = typeof query?.origin === 'string' && MEDIA_ORIGINS.includes(query.origin as MediaOrigin)
    ? query.origin as MediaOrigin : undefined;
  const kind = typeof query?.kind === 'string' && MEDIA_KINDS.includes(query.kind as MediaKind)
    ? query.kind as MediaKind : undefined;
  const filters = origin || kind ? { origin, kind } : undefined;
  const base = `/models/${encodeURIComponent(id)}`;
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'media')) return <div className="card"><h2>Media access unavailable</h2><p>Your role does not include this library.</p><Link href="/">Back to workspace</Link></div>;
  const canEdit = ['owner', 'manager', 'operator', 'content_creator'].includes(role ?? '');
  const canCreateVariant = ['owner', 'manager', 'operator'].includes(role ?? '');
  const canReadOperations = role !== 'model';
  let result: Awaited<ReturnType<typeof api.models.media>> | undefined;
  let operations: Awaited<ReturnType<typeof api.models.mediaOperations>>['data'] = [];
  let operationsFailed = false;
  await Promise.all([
    (filters ? api.models.media(id, cursor, filters) : api.models.media(id, cursor)).then(value => { result = value; }).catch(() => {}),
    canReadOperations ? api.models.mediaOperations(id).then(value => { operations = value.data; }).catch(() => { operationsFailed = true; }) : Promise.resolve(),
  ]);
  const mediaItems = result?.data ?? [];
  return <div className="page-stack">
    <h2>Media library</h2>
    <p>Saved uploads and generated media for this talent. Being in this library does not mean an asset passed review or is approved for publication.</p>
    <div className="action-row">{canEdit && <Link href={`${base}/generation`}>Upload or create media</Link>}{talentDestinationAllowed(role, 'approvals') && <Link href={`${base}/approvals`}>Review content bundles</Link>}</div>
    <form method="get" className="card stack" aria-label="Filter media library">
      <strong>Filter saved media</strong>
      <div className="row">
        <label>Source
          <select name="origin" defaultValue={origin ?? ''}>
            <option value="">All sources</option>
            <option value="uploaded">Uploaded source</option>
            <option value="generated">Generated</option>
            <option value="transformed">Transformed</option>
            <option value="legacy">Legacy or unknown</option>
          </select>
        </label>
        <label>Type
          <select name="kind" defaultValue={kind ?? ''}>
            <option value="">Images and videos</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
        </label>
        <button type="submit" className="btn secondary">Apply filters</button>
        {(origin || kind) && <Link href={mediaHref(base, undefined, undefined, undefined)}>Clear filters</Link>}
      </div>
      {(origin || kind) && <p className="subtle">Showing {origin ?? 'all sources'} · {kind ?? 'images and videos'}.</p>}
    </form>
    {canEdit && <MediaUpload modelId={id} />}
    {operationsFailed && <p role="alert">Transformation status could not be loaded. Saved media is still available; refresh before starting another transformation.</p>}
    {!result ? <p role="alert">Media could not be loaded. Refresh to try again.</p> : mediaItems.length === 0 ? <p>No saved media in this page.</p> : <div className="grid">
      {mediaItems.map(asset => {
        const src = `/api/v1/models/${encodeURIComponent(id)}/media/${encodeURIComponent(asset.id)}`;
        const lifecycle = lifecyclePresentation(asset);
        const resultAssetIds = asset.resultAssetIds ?? [];
        const pageAssetIds = new Set(mediaItems.map(item => item.id));
        const visibleResultIds = resultAssetIds.filter(resultId => pageAssetIds.has(resultId));
        return <article key={asset.id} id={`media-${asset.id}`} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h3>{assetTitle(asset)} {asset.kind === 'video' ? 'video' : 'image'}</h3>
            <span className={`badge ${lifecycle.tone}`}>{lifecycle.label}</span>
          </div>
          <BundleMedia modelId={id} assetId={asset.id} />
          <p className="subtle">{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}{Math.ceil(asset.fileSize / 1024)} KB · {asset.createdAt}</p>
          <p className="subtle">{lifecycle.detail}</p>
          {asset.sourceAssetId && <p className="subtle">Derived from source media: {pageAssetIds.has(asset.sourceAssetId) ? <a href={`#media-${asset.sourceAssetId}`}>{shortAssetId(asset.sourceAssetId)}</a> : <span className="mono">{shortAssetId(asset.sourceAssetId)}</span>}</p>}
          {resultAssetIds.length > 0 && <p className="subtle">{resultAssetIds.length} saved result{resultAssetIds.length === 1 ? '' : 's'}{visibleResultIds.length > 0 && <>: {visibleResultIds.map((resultId, index) => <span key={resultId}>{index > 0 ? ', ' : ''}<a href={`#media-${resultId}`}>{shortAssetId(resultId)}</a></span>)}</>}</p>}
          <div className="action-row"><a href={src} target="_blank" rel="noopener noreferrer">Open saved media</a>{canEdit && asset.kind === 'image' && <Link href={`${base}/generation?${new URLSearchParams({ sourceAssetId: asset.id })}`}>Use for video</Link>}</div>
          {canReadOperations && !operationsFailed && <MediaOperationControls modelId={id} assetId={asset.id} kind={asset.kind} operations={operations} canEdit={canEdit} />}
          {canEdit && <MediaBundleCreate modelId={id} assetId={asset.id} mimeType={asset.mimeType} />}
          {canCreateVariant && <CopyVariantCreate modelId={id} assetId={asset.id} />}
        </article>;
      })}
    </div>}
    <nav className="action-row" aria-label="Media library pages">
      {cursor && <Link href={mediaHref(base, undefined, origin, kind)}>Latest media</Link>}
      {result?.meta?.next_cursor && <Link href={mediaHref(base, result.meta.next_cursor, origin, kind)}>Older media</Link>}
    </nav>
  </div>;
}
