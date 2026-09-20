import Link from 'next/link';
import { api } from '@/lib/api';
import NewModelForm from '@/components/NewModelForm';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { t } = await getServerLocale();
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
          <p className="eyebrow">{t('home.eyebrow')}</p>
          <h1>{t('home.title')}</h1>
          <p className="page-intro">
            {t('home.intro')}
          </p>
        </div>
        <NewModelForm />
      </section>

      <section className="card stack" aria-labelledby="getting-started-heading">
        <h2 id="getting-started-heading">{t('home.gettingStarted')}</h2>
        <p className="subtle">{t('home.gettingStartedDescription')}</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Link href="/connections/grok" className="btn secondary">{t('home.setupGrok')}</Link>
          <a href="#talent-profiles" className="btn secondary">{t('home.chooseTalent')}</a>
        </div>
      </section>

      <section className="stat-grid" aria-label={t('home.portfolioSummary')}>
        <div className="stat-card">
          <span>{t('home.totalTalent')}</span>
          <strong>{totalCount ?? t('home.unavailable')}</strong>
          <small>{totalCount === null ? t('home.countUnavailable') : t('home.profilesInStudio')}</small>
        </div>
        <div className="stat-card">
          <span>{t('home.activeOnPage')}</span>
          <strong>{activeCount}</strong>
          <small>{t('home.profilesMarkedActive')}</small>
        </div>
        <div className="stat-card accent">
          <span>{t('home.profileList')}</span>
          <strong>{error ? t('home.unavailable') : t('home.loaded')}</strong>
          <small>{error ? t('home.profileRequestFailed') : t('home.profilesShown', { count: models.length })}</small>
        </div>
      </section>

      {error && (
        <div className="notice error" role="alert">
          <strong>{t('home.workspaceUnreachable')}</strong>
          <span className="mono">{error}</span>
        </div>
      )}

      {models.length === 0 && !error && (
        <div className="empty-state card">
          <span className="empty-mark">A</span>
          <h2>{cursor ? t('home.noMoreProfiles') : t('home.noProfilesYet')}</h2>
          <p>
            {cursor ? t('home.returnFirstPage') : t('home.createFirstProfile')}
          </p>
        </div>
      )}

      {models.length > 0 && (
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('home.roster')}</p>
            <h2>{t('home.talentProfiles')}</h2>
          </div>
          <span>{t('home.shown', { count: models.length })}</span>
        </div>
      )}
      <div id="talent-profiles" className="grid talent-grid" tabIndex={-1}>
        {models.map((model) => (
          <div key={model.id}>
          <Link href={`/models/${model.id}`} className="model-link">
            <article className="card model-card">
              <div className="model-card-top">
                <span className="talent-avatar small">
                  {model.displayName.slice(0, 1).toUpperCase()}
                </span>
                {model.isActive ? (
                  <span className="badge good">
                    <i /> {t('home.active')}
                  </span>
                ) : (
                  <span className="badge mute">
                    <i /> {t('home.inactive')}
                  </span>
                )}
              </div>
              <div className="model-card-copy">
                <h2>{model.displayName}</h2>
                <p className="handle">@{model.handle}</p>
              </div>
              <p className="model-bio">{model.bio || t('home.freshProfile')}</p>
              <span className="card-link">
                {t('home.openWorkspace')} <span aria-hidden="true">→</span>
              </span>
            </article>
          </Link>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
            <Link href={`/models/${model.id}/generation`} className="btn">{t('home.generateMedia')}</Link>
            <Link href={`/models/${model.id}/approvals`} className="btn secondary">{t('home.reviewContent')}</Link>
          </div>
          </div>
        ))}
      </div>
      {(cursor || nextCursor) && (
        <nav aria-label={t('home.talentPagination')} className="section-heading">
          {cursor && <Link href="/">{t('home.firstPage')}</Link>}
          {!error && nextCursor && <Link href={`/?${new URLSearchParams({ cursor: nextCursor })}`}>{t('home.nextPage')}</Link>}
        </nav>
      )}
    </div>
  );
}
