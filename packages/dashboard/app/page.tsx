import Link from 'next/link';
import { api } from '@/lib/api';
import NewModelForm from '@/components/NewModelForm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let models: Awaited<ReturnType<typeof api.models.list>>['data'] = [];
  let error: string | null = null;
  try {
    models = (await api.models.list()).data;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Models</h1>
        <NewModelForm />
      </div>

      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          API unreachable: <span className="mono">{error}</span>
        </div>
      )}

      {models.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No models yet. Create your first talent profile to begin.
          </p>
        </div>
      )}

      <div className="grid">
        {models.map((m) => (
          <Link key={m.id} href={`/models/${m.id}`} className="model-link">
            <div className="card model-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{m.displayName}</h2>
                {m.isActive ? (
                  <span className="badge good">active</span>
                ) : (
                  <span className="badge mute">inactive</span>
                )}
              </div>
              <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>@{m.handle}</p>
              {m.bio && <p style={{ margin: '8px 0 0' }}>{m.bio}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
