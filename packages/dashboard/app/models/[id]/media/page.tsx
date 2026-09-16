import Link from 'next/link';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';
export default async function MediaPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  const base = `/models/${encodeURIComponent(id)}`;
  let result: Awaited<ReturnType<typeof api.models.media>> | undefined;
  try { result = await api.models.media(id, cursor); } catch { /* Render an explicit unavailable state. */ }
  return <div className="page-stack">
    <h2>Media library</h2>
    <p>Saved uploads and generated media for this talent. Being in this library does not mean an asset passed review or is approved for publication.</p>
    <div className="action-row"><Link href={`${base}/generation`}>Upload or create media</Link><Link href={`${base}/approvals`}>Review content bundles</Link></div>
    {!result ? <p role="alert">Media could not be loaded. Refresh to try again.</p> : result.data.length === 0 ? <p>No saved media in this page.</p> : <div className="grid">
      {result.data.map(asset => {
        const src = `/api/v1/models/${encodeURIComponent(id)}/media/${encodeURIComponent(asset.id)}`;
        return <article key={asset.id} className="card stack">
          <h3>{asset.kind === 'video' ? 'Saved video' : 'Saved image'}</h3>
          {asset.mimeType === 'video/mp4' ? <video controls playsInline preload="metadata" src={src} style={{ maxWidth: '100%', maxHeight: 480 }} />
            : ['image/jpeg', 'image/png'].includes(asset.mimeType) ?
              // Authenticated images must not pass through a public optimization service.
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" src={src} alt="Saved talent media" style={{ width: '100%', maxHeight: 480, objectFit: 'contain' }} /> : <p>Preview format unavailable.</p>}
          <p className="subtle">{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}{Math.ceil(asset.fileSize / 1024)} KB · {asset.createdAt}</p>
          <a href={src} target="_blank" rel="noopener noreferrer">Open saved media</a>
        </article>;
      })}
    </div>}
    <nav className="action-row" aria-label="Media library pages">
      {cursor && <Link href={`${base}/media`}>Latest media</Link>}
      {result?.meta?.next_cursor && <Link href={`${base}/media?${new URLSearchParams({ cursor: result.meta.next_cursor })}`}>Older media</Link>}
    </nav>
  </div>;
}
