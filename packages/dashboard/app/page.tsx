import Link from 'next/link';
import { api } from '@/lib/api';
import NewModelForm from '@/components/NewModelForm';
import TalentRoster from '@/components/TalentRoster';
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

      <TalentRoster models={models} totalCount={totalCount} nextCursor={nextCursor} cursor={cursor} error={!!error} />
    </div>
  );
}
