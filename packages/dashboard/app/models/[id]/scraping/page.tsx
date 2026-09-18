import { api, getSession } from '@/lib/api';
import ScrapeRunManager from '@/components/ScrapeRunManager';

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
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const result = await api.models.scrapeRuns(id, cursor);
    return <div className="page-stack"><h2>Trend & competitor radar</h2><div className="card"><ScrapeRunManager modelId={id} runs={result.data} nextCursor={result.meta.next_cursor} cursor={cursor} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>Scraper unavailable</h2><p>Research runs could not be loaded. No scrape was started.</p></div>;
  }
}
