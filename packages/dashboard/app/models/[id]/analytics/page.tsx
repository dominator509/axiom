import { api, getSession } from '@/lib/api';
import type { PlaybookGuideline } from '@/lib/api';
import Link from 'next/link';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import PerformancePatterns, { type PerformancePattern } from '@/components/PerformancePatterns';

export const dynamic = 'force-dynamic';

interface AnalyticsData {
  windowDays: number;
  totals: { views: number; likes: number; shares: number; comments: number };
  perPlatform: Array<{
    platform: string;
    views: number;
    likes: number;
    shares: number;
    comments: number;
    engagementRate: number;
  }>;
  daily: Array<{ day: string; views: number; likes: number }>;
  postsWithMetrics: number;
}

interface ViralData {
  patterns?: { groups: PerformancePattern[]; truncated: boolean; minimumSample: number };
  totalExemplars: number;
  byLabel: Array<{ label: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  top: Array<{ id: string; platform: string; label: string; perfScore: number }>;
}

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!talentDestinationAllowed((await getSession())?.user?.role, 'analytics')) return <div className="card stack"><h2>Analytics access unavailable</h2><p>Your role does not include these performance records.</p><Link href="/">Back to workspace</Link></div>;
  const reportMonth = new Date().toISOString().slice(0, 7);
  let analytics: AnalyticsData | null = null;
  let viral: ViralData | null = null;
  let playbookGuidelines: PlaybookGuideline[] | null = null;
  let playbookUnavailable = false;
  try {
    analytics = (await api.models.analytics(id, 30)).data as unknown as AnalyticsData;
  } catch {
    analytics = null;
  }
  try {
    viral = (await api.models.viral(id)).data as unknown as ViralData;
  } catch {
    viral = null;
  }
  try {
    playbookGuidelines = (await api.models.playbookGuidelines(id)).data;
  } catch {
    playbookUnavailable = true;
  }

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <h2 style={{ margin: 0 }}>Performance</h2>
        <a className="btn secondary" href={`/api/v1/models/${encodeURIComponent(id)}/reports/monthly?month=${reportMonth}`}>
          Download monthly PDF
        </a>
      </div>
      {analytics ? (
        <>
          <div className="grid">
            <div className="card">
              <h3>Views</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {analytics.totals.views.toLocaleString()}
              </div>
              <p style={{ color: 'var(--muted)', margin: 0 }}>last {analytics.windowDays} days</p>
            </div>
            <div className="card">
              <h3>Likes</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {analytics.totals.likes.toLocaleString()}
              </div>
            </div>
            <div className="card">
              <h3>Shares</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {analytics.totals.shares.toLocaleString()}
              </div>
            </div>
            <div className="card">
              <h3>Comments</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {analytics.totals.comments.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Per platform</h3>
            {analytics.perPlatform.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No metrics ingested yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Views</th>
                    <th>Likes</th>
                    <th>Shares</th>
                    <th>Comments</th>
                    <th>Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.perPlatform.map((p) => (
                    <tr key={p.platform}>
                      <td>{p.platform}</td>
                      <td>{p.views.toLocaleString()}</td>
                      <td>{p.likes.toLocaleString()}</td>
                      <td>{p.shares.toLocaleString()}</td>
                      <td>{p.comments.toLocaleString()}</td>
                      <td>{(p.engagementRate * 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {analytics.daily.length > 0 && (
            <div className="card">
              <h3>Daily trend (last {Math.min(analytics.daily.length, 14)} days)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Views</th>
                    <th>Likes</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.daily.slice(-14).map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{d.views.toLocaleString()}</td>
                      <td>{d.likes.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <p style={{ color: 'var(--muted)' }}>Analytics unavailable.</p>
        </div>
      )}

      <section className="card stack" aria-label="Playbook analytics context">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>Playbook guidance context</h3>
            <p className="subtle" style={{ margin: 0 }}>Saved model/platform guidance is advisory context for this report; it does not reinterpret metrics or schedule anything.</p>
          </div>
          <Link href={`/models/${encodeURIComponent(id)}/playbook`}>Review playbook</Link>
        </div>
        {playbookUnavailable ? <p role="alert">Playbook guidance could not be loaded. No guideline-derived interpretation is shown.</p>
          : !playbookGuidelines?.length ? <p className="subtle">No playbook guidelines saved for this talent. Analytics remain unopinionated.</p>
          : <div className="grid">{playbookGuidelines.map(guideline => <article className="card" key={guideline.id} style={{ background: 'var(--panel2)' }}>
            <strong>{guideline.platform} · revision {guideline.revision}</strong>
            <p>Cadence target: {guideline.cadencePerWeek} posts/week.</p>
            <p>Suggested posting times: {guideline.optimalTimes.length ? guideline.optimalTimes.join(', ') : 'none saved'}.</p>
            <p className="subtle">Upsell strategy: {guideline.upsellStrategy || 'none configured'}.</p>
          </article>)}</div>}
      </section>

      <h2 style={{ marginTop: 24 }}>Viral insights</h2>
      <PerformancePatterns patterns={viral?.patterns} />
      <p className="subtle">Only verified exemplars backed by published posts and matching provider observations appear here. Scores describe relative engagement, not conversions or proof that a caption caused an outcome.</p>
      <div className="card">
        {!viral ? <p role="alert">Viral insights could not be loaded. Reload this page to try again.</p> : viral.totalExemplars === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No verified published exemplars yet — they accumulate after attributable provider metrics are labeled.
          </p>
        ) : (
          <div className="grid">
            <div className="card" style={{ background: 'var(--panel2)' }}>
              <h3>Labels</h3>
              {viral.byLabel.map((l) => (
                <div key={l.label} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{l.label}</span>
                  <strong>{l.count}</strong>
                </div>
              ))}
            </div>
            <div className="card" style={{ background: 'var(--panel2)' }}>
              <h3>By platform</h3>
              {viral.byPlatform.map((p) => (
                <div key={p.platform} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{p.platform}</span>
                  <strong>{p.count}</strong>
                </div>
              ))}
            </div>
            <div className="card" style={{ background: 'var(--panel2)' }}>
              <h3>Top performers</h3>
              {viral.top.slice(0, 5).map((t) => (
                <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono">{t.platform}</span>
                  <span className={`badge ${t.label === 'viral' ? 'good' : 'warn'}`}>
                    {t.label} · {(t.perfScore ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
