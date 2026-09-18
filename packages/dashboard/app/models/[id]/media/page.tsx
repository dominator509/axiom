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
    {!result ? <p role="alert">Media could not be loaded. Refresh to try again.</p> : result.data.length === 0 ? <p>No saved media in this page.</p> : <div className="grid">
      {result.data.map(asset => {
        const src = `/api/v1/models/${encodeURIComponent(id)}/media/${encodeURIComponent(asset.id)}`;
        return <article key={asset.id} className="card stack">
          <h3>{asset.origin === 'uploaded' ? 'Uploaded source' : asset.origin === 'generated' ? 'Generated media' : asset.origin === 'transformed' ? 'Transformed media' : 'Saved'} {asset.kind === 'video' ? 'video' : 'image'}</h3>
          <BundleMedia modelId={id} assetId={asset.id} />
          <p className="subtle">{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}{Math.ceil(asset.fileSize / 1024)} KB · {asset.createdAt}</p>
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
