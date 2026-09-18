import Link from 'next/link';
import { api } from '@/lib/api';
import BundleMedia from '@/components/BundleMedia';
import MediaOperationControls from '@/components/MediaOperationControls';
import MediaBundleCreate from '@/components/MediaBundleCreate';
import CopyVariantCreate from '@/components/CopyVariantCreate';
import MediaUpload from '@/components/MediaUpload';
import { getSession } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';
export default async function MediaPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
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
    api.models.media(id, cursor).then(value => { result = value; }).catch(() => {}),
    canReadOperations ? api.models.mediaOperations(id).then(value => { operations = value.data; }).catch(() => { operationsFailed = true; }) : Promise.resolve(),
  ]);
  return <div className="page-stack">
    <h2>Media library</h2>
    <p>Saved uploads and generated media for this talent. Being in this library does not mean an asset passed review or is approved for publication.</p>
    <div className="action-row">{canEdit && <Link href={`${base}/generation`}>Upload or create media</Link>}{talentDestinationAllowed(role, 'approvals') && <Link href={`${base}/approvals`}>Review content bundles</Link>}</div>
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
      {cursor && <Link href={`${base}/media`}>Latest media</Link>}
      {result?.meta?.next_cursor && <Link href={`${base}/media?${new URLSearchParams({ cursor: result.meta.next_cursor })}`}>Older media</Link>}
    </nav>
  </div>;
}
