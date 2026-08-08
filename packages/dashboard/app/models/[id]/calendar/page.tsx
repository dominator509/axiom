import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();

  let posts: Awaited<ReturnType<typeof api.models.calendar>>['data'] = [];
  let error: string | null = null;
  try {
    posts = (await api.models.calendar(id, from, to)).data;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Calendar (F-10)</h2>
        <span style={{ color: 'var(--muted)' }}>{posts.length} scheduled</span>
      </div>
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {posts.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No scheduled posts in the window. Approve a generated bundle to schedule.
          </p>
        </div>
      )}
      <div className="grid">
        {posts.map((p) => (
          <div key={p.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="mono">{p.platform}</span>
              <span
                className={`badge ${p.state === 'published' ? 'good' : p.state === 'failed' ? 'bad' : 'mute'}`}
              >
                {p.state}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              {p.scheduledFor ? new Date(p.scheduledFor).toLocaleString() : 'not scheduled'}
            </div>
            {p.error && (
              <div style={{ color: 'var(--bad)', marginTop: 6 }} className="mono">
                {p.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
