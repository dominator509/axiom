import { api, getSession } from '@/lib/api';
import ScrapeRunManager from '@/components/ScrapeRunManager';

export const dynamic = 'force-dynamic';

export default async function ScrapingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const runs = (await api.models.scrapeRuns(id)).data;
    return <div className="page-stack"><h2>Trend & competitor radar</h2><div className="card"><ScrapeRunManager modelId={id} runs={runs} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>Scraper unavailable</h2><p>Research runs could not be loaded. No scrape was started.</p></div>;
  }
}
