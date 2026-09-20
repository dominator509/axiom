import Link from 'next/link';
import { api } from '@/lib/api';
import BundleMedia from '@/components/BundleMedia';
import MediaOperationControls from '@/components/MediaOperationControls';
import MediaBundleCreate from '@/components/MediaBundleCreate';
import CopyVariantCreate from '@/components/CopyVariantCreate';
import MediaUpload from '@/components/MediaUpload';
import { getSession, type MediaKind, type MediaOrigin } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';
const MEDIA_ORIGINS: readonly MediaOrigin[] = ['uploaded', 'generated', 'transformed', 'legacy'];
const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video'];
type MediaAsset = Awaited<ReturnType<typeof api.models.media>>['data'][number];
type Translator = Awaited<ReturnType<typeof getServerLocale>>['t'];

function assetTitle(t: Translator, asset: MediaAsset): string {
  if (asset.origin === 'uploaded') return t('media.assetTitleUploaded');
  if (asset.origin === 'generated') return t('media.assetTitleGenerated');
  if (asset.origin === 'transformed') return t('media.assetTitleTransformed');
  return t('media.assetTitleSaved');
}

function lifecyclePresentation(t: Translator, asset: MediaAsset): { label: string; tone: 'good' | 'warn' | 'bad' | 'mute'; detail: string } {
  if (!asset.operationId) return { label: t('media.assetTitleSaved'), tone: 'mute', detail: t('media.savedDetail') };
  switch (asset.status) {
    case 'queued': return { label: t('media.lifecycleQueued'), tone: 'warn', detail: t('media.lifecycleQueuedDetail') };
    case 'running': return { label: t('media.lifecycleRunning'), tone: 'warn', detail: t('media.lifecycleRunningDetail') };
    case 'failed': return { label: t('media.lifecycleFailed'), tone: 'bad', detail: t('media.lifecycleFailedDetail') };
    case 'completed': return { label: t('media.lifecycleCompleted'), tone: 'good', detail: t('media.lifecycleCompletedDetail') };
    default: return { label: t('media.lifecycleUnavailable'), tone: 'mute', detail: t('media.lifecycleUnavailableDetail') };
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
  const { t, dateTime } = await getServerLocale();
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'media')) return <div className="card"><h2>{t('media.accessUnavailable')}</h2><p>{t('media.accessDescription')}</p><Link href="/">{t('media.back')}</Link></div>;
  const canEdit = ['owner', 'manager', 'operator', 'content_creator'].includes(role ?? '');
  const canCreateVariant = ['owner', 'manager', 'operator'].includes(role ?? '');
  const canReadOperations = role !== 'model';
  const originLabel = origin ? t(`media.origin${origin === 'uploaded' ? 'Uploaded' : origin === 'generated' ? 'Generated' : origin === 'transformed' ? 'Transformed' : 'Legacy'}`) : t('media.showingAllSources');
  const kindLabel = kind ? t(kind === 'image' ? 'media.kindImage' : 'media.kindVideo') : t('media.showingAllKinds');
  let result: Awaited<ReturnType<typeof api.models.media>> | undefined;
  let operations: Awaited<ReturnType<typeof api.models.mediaOperations>>['data'] = [];
  let operationsFailed = false;
  await Promise.all([
    (filters ? api.models.media(id, cursor, filters) : api.models.media(id, cursor)).then(value => { result = value; }).catch(() => {}),
    canReadOperations ? api.models.mediaOperations(id).then(value => { operations = value.data; }).catch(() => { operationsFailed = true; }) : Promise.resolve(),
  ]);
  const mediaItems = result?.data ?? [];
  return <div className="page-stack">
    <h2>{t('media.title')}</h2>
    <p>{t('media.description')}</p>
    <div className="action-row">{canEdit && <Link href={`${base}/generation`}>{t('media.uploadOrCreate')}</Link>}{talentDestinationAllowed(role, 'approvals') && <Link href={`${base}/approvals`}>{t('media.reviewBundles')}</Link>}</div>
    <form method="get" className="card stack" aria-label={t('media.filterAria')}>
      <strong>{t('media.filterTitle')}</strong>
      <div className="row">
        <label>{t('media.sourceLabel')}
          <select name="origin" defaultValue={origin ?? ''}>
            <option value="">{t('media.allSources')}</option>
            <option value="uploaded">{t('media.originUploaded')}</option>
            <option value="generated">{t('media.originGenerated')}</option>
            <option value="transformed">{t('media.originTransformed')}</option>
            <option value="legacy">{t('media.originLegacy')}</option>
          </select>
        </label>
        <label>{t('media.typeLabel')}
          <select name="kind" defaultValue={kind ?? ''}>
            <option value="">{t('media.allKinds')}</option>
            <option value="image">{t('media.kindImage')}</option>
            <option value="video">{t('media.kindVideo')}</option>
          </select>
        </label>
        <button type="submit" className="btn secondary">{t('media.applyFilters')}</button>
        {(origin || kind) && <Link href={mediaHref(base, undefined, undefined, undefined)}>{t('media.clearFilters')}</Link>}
      </div>
      {(origin || kind) && <p className="subtle">{t('media.showingFilters', { origin: originLabel, kind: kindLabel })}</p>}
    </form>
    {canEdit && <MediaUpload modelId={id} />}
    {operationsFailed && <p role="alert">{t('media.operationsLoadFailed')}</p>}
    {!result ? <p role="alert">{t('media.loadFailed')}</p> : mediaItems.length === 0 ? <p>{t('media.emptyPage')}</p> : <div className="grid">
      {mediaItems.map(asset => {
        const src = `/api/v1/models/${encodeURIComponent(id)}/media/${encodeURIComponent(asset.id)}`;
        const lifecycle = lifecyclePresentation(t, asset);
        const resultAssetIds = asset.resultAssetIds ?? [];
        const pageAssetIds = new Set(mediaItems.map(item => item.id));
        const visibleResultIds = resultAssetIds.filter(resultId => pageAssetIds.has(resultId));
        return <article key={asset.id} id={`media-${asset.id}`} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h3>{assetTitle(t, asset)} {asset.kind === 'video' ? t('media.kindVideo') : t('media.kindImage')}</h3>
            <span className={`badge ${lifecycle.tone}`}>{lifecycle.label}</span>
          </div>
          <BundleMedia modelId={id} assetId={asset.id} />
          <p className="subtle">{asset.width && asset.height ? t('media.dimensions', { width: asset.width, height: asset.height }) : ''}{Math.ceil(asset.fileSize / 1024)} KB · {dateTime(asset.createdAt)}</p>
          <p className="subtle">{lifecycle.detail}</p>
          {asset.sourceAssetId && <p className="subtle">{t('media.derivedFromSource')} {pageAssetIds.has(asset.sourceAssetId) ? <a href={`#media-${asset.sourceAssetId}`}>{shortAssetId(asset.sourceAssetId)}</a> : <span className="mono">{shortAssetId(asset.sourceAssetId)}</span>}</p>}
          {resultAssetIds.length > 0 && <p className="subtle">{t(resultAssetIds.length === 1 ? 'media.resultCountOne' : 'media.resultCountMany', { count: resultAssetIds.length })}{visibleResultIds.length > 0 && <>: {visibleResultIds.map((resultId, index) => <span key={resultId}>{index > 0 ? ', ' : ''}<a href={`#media-${resultId}`}>{shortAssetId(resultId)}</a></span>)}</>}</p>}
          <div className="action-row"><a href={src} target="_blank" rel="noopener noreferrer">{t('media.openSaved')}</a>{canEdit && asset.kind === 'image' && <Link href={`${base}/generation?${new URLSearchParams({ sourceAssetId: asset.id })}`}>{t('media.useForVideo')}</Link>}</div>
          {canReadOperations && !operationsFailed && <MediaOperationControls modelId={id} assetId={asset.id} kind={asset.kind} operations={operations} canEdit={canEdit} />}
          {canEdit && <MediaBundleCreate modelId={id} assetId={asset.id} mimeType={asset.mimeType} />}
          {canCreateVariant && <CopyVariantCreate modelId={id} assetId={asset.id} />}
        </article>;
      })}
    </div>}
    <nav className="action-row" aria-label={t('media.pagesAria')}>
      {cursor && <Link href={mediaHref(base, undefined, origin, kind)}>{t('media.latest')}</Link>}
      {result?.meta?.next_cursor && <Link href={mediaHref(base, result.meta.next_cursor, origin, kind)}>{t('media.older')}</Link>}
    </nav>
  </div>;
}
