import Link from 'next/link';
import { api } from '@/lib/api';
import NewModelForm from '@/components/NewModelForm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let models: Awaited<ReturnType<typeof api.models.list>>['data'] = [];
  let error: string | null = null;
  try {
    models = (await api.models.list()).data;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

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
          <strong>{models.length}</strong>
          <small>profiles in your studio</small>
        </div>
        <div className="stat-card">
          <span>Active now</span>
          <strong>{activeCount}</strong>
          <small>ready for publishing</small>
        </div>
        <div className="stat-card accent">
          <span>Studio status</span>
          <strong>{error ? 'Needs attention' : 'Ready'}</strong>
          <small>{error ? 'API connection unavailable' : 'private systems connected'}</small>
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
          <h2>Your studio is ready.</h2>
          <p>
            Create your first talent profile to begin shaping her brand, content, and growth engine.
          </p>
        </div>
      )}

      {models.length > 0 && (
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your roster</p>
            <h2>Talent profiles</h2>
          </div>
          <span>{models.length} total</span>
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
    </div>
  );
}
