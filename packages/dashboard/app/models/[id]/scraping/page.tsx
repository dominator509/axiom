import { api, getSession } from '@/lib/api';
import ScrapeRunManager from '@/components/ScrapeRunManager';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function ScrapingPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ cursor?: string | string[] }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const rawCursor = query.cursor;
  const cursor = Array.isArray(rawCursor) ? rawCursor[0] : rawCursor;
  const session = await getSession();
  const { t } = await getServerLocale();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const result = await api.models.scrapeRuns(id, cursor);
    return <div className="page-stack"><h2>{t('scrape.title')}</h2><div className="card"><ScrapeRunManager modelId={id} runs={result.data} benchmark={result.meta.competitor_benchmark} nextCursor={result.meta.next_cursor} cursor={cursor} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('scrape.unavailable')}</h2><p>{t('scrape.loadFailed')}</p></div>;
  }
}
