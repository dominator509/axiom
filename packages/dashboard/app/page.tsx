import Link from 'next/link';
import { api } from '@/lib/api';
import NewModelForm from '@/components/NewModelForm';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  let models: Awaited<ReturnType<typeof api.models.list>>['data'] = [];
  let nextCursor: string | null = null;
  let totalCount: number | null = null;
  let error: string | null = null;
  const [page, count] = await Promise.allSettled([api.models.list(cursor), api.models.count()]);
  if (page.status === 'fulfilled') {
    models = page.value.data;
    nextCursor = page.value.meta.next_cursor;
  } else {
    const caught: unknown = page.reason;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  if (count.status === 'fulfilled') totalCount = count.value.data.count;

  const activeCount = models.filter((model) => model.isActive).length;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Your talent, beautifully organized.</h1>
          <p className="page-intro">
            Create, grow, and protect every creator brand from one private command center.
          </p>
        </div>
        <NewModelForm />
      </section>

      <section className="stat-grid" aria-label="Portfolio summary">
        <div className="stat-card">
          <span>Total talent</span>
          <strong>{totalCount ?? 'Unavailable'}</strong>
          <small>{totalCount === null ? 'Profile count could not be loaded' : 'profiles in your studio'}</small>
        </div>
        <div className="stat-card">
          <span>Active on this page</span>
          <strong>{activeCount}</strong>
          <small>profiles marked active</small>
        </div>
        <div className="stat-card accent">
          <span>Profile list</span>
          <strong>{error ? 'Unavailable' : 'Loaded'}</strong>
          <small>{error ? 'Profile request failed' : `${models.length} profiles shown`}</small>
        </div>
      </section>

      {error && (
        <div className="notice error" role="alert">
          <strong>We could not reach your workspace.</strong>
          <span className="mono">{error}</span>
        </div>
      )}

      {models.length === 0 && !error && (
        <div className="empty-state card">
          <span className="empty-mark">A</span>
          <h2>{cursor ? 'No more profiles on this page.' : 'No talent profiles yet.'}</h2>
          <p>
            {cursor ? 'Return to the first page to view your roster.' : 'Create your first talent profile to begin.'}
          </p>
        </div>
      )}

      {models.length > 0 && (
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your roster</p>
            <h2>Talent profiles</h2>
          </div>
          <span>{models.length} shown</span>
        </div>
      )}
      <div className="grid talent-grid">
        {models.map((model) => (
          <Link key={model.id} href={`/models/${model.id}`} className="model-link">
            <article className="card model-card">
              <div className="model-card-top">
                <span className="talent-avatar small">
                  {model.displayName.slice(0, 1).toUpperCase()}
                </span>
                {model.isActive ? (
                  <span className="badge good">
                    <i /> Active
                  </span>
                ) : (
                  <span className="badge mute">
                    <i /> Inactive
                  </span>
                )}
              </div>
              <div className="model-card-copy">
                <h2>{model.displayName}</h2>
                <p className="handle">@{model.handle}</p>
              </div>
              <p className="model-bio">{model.bio || 'A fresh creator profile ready to define.'}</p>
              <span className="card-link">
                Open workspace <span aria-hidden="true">→</span>
              </span>
            </article>
          </Link>
        ))}
      </div>
      {(cursor || nextCursor) && (
        <nav aria-label="Talent pagination" className="section-heading">
          {cursor && <Link href="/">First page</Link>}
          {!error && nextCursor && <Link href={`/?${new URLSearchParams({ cursor: nextCursor })}`}>Next page</Link>}
        </nav>
      )}
    </div>
  );
}
