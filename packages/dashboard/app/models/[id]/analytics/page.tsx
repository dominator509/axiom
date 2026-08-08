import { api } from '@/lib/api';

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
  totalExemplars: number;
  byLabel: Array<{ label: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  top: Array<{ id: string; platform: string; label: string; perfScore: number }>;
}

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let analytics: AnalyticsData | null = null;
  let viral: ViralData | null = null;
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

  return (
    <div>
      <h2>Analytics (F-27 / F-85)</h2>
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

      <h2 style={{ marginTop: 24 }}>Viral insights (F-85)</h2>
      <div className="card">
        {!viral || viral.totalExemplars === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No viral exemplars yet — they accumulate as posts get labeled.
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
