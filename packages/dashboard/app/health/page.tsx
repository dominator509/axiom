import Link from 'next/link';
import NetworkHealth from '@/components/NetworkHealth';
import { api, getSession, type ModelProfile } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

async function settled<T>(request: Promise<T>): Promise<{ value: T } | { failed: true }> {
  try {
    return { value: await request };
  } catch {
    return { failed: true };
  }
}

export default async function HealthPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const cursor = typeof query?.modelCursor === 'string' ? query.modelCursor : undefined;
  const role = (await getSession())?.user?.role;
  const { t } = await getServerLocale();
  const [liveness, readiness, modelPage] = await Promise.all([
    settled(api.health.liveness()),
    settled(api.health.readiness()),
    role === 'owner' ? settled(api.models.list(cursor)) : Promise.resolve(null),
  ]);

  const apiHealthy = 'value' in liveness && liveness.value.status === 'ok';
  const databaseHealthy = 'value' in readiness
    && readiness.value.status === 'ok'
    && readiness.value.dependencies.postgres === 'ok';
  const models: ModelProfile[] = modelPage && 'value' in modelPage ? modelPage.value.data : [];
  const nextModelCursor = modelPage && 'value' in modelPage ? modelPage.value.meta.next_cursor : null;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">{t('layout.systemHealth')}</p>
          <h1>{t('health.title')}</h1>
          <p>{t('health.description')}</p>
        </div>
      </section>

      <section className="card stack" aria-labelledby="health-services-title">
        <h2 id="health-services-title">{t('health.services')}</h2>
        <div className="grid">
          <article className="card stack">
            <h3>{t('health.apiLiveness')}</h3>
            <p role="status">{apiHealthy ? t('health.available') : t('health.unavailable')}</p>
            <p className="subtle">{t('health.apiLivenessDetails')}</p>
          </article>
          <article className="card stack">
            <h3>{t('health.databaseReadiness')}</h3>
            <p role="status">{databaseHealthy ? t('health.available') : t('health.unavailable')}</p>
            <p className="subtle">{t('health.databaseDetails')}</p>
          </article>
        </div>
        <div className="action-row">
          <Link className="btn secondary" href="/incidents">{t('health.incidentsLink')}</Link>
          <Link className="btn secondary" href="/api/v1/metrics">{t('health.metricsLink')}</Link>
        </div>
      </section>

      {role === 'owner' && (
        <section className="stack" aria-labelledby="health-egress-title">
          <div>
            <h2 id="health-egress-title">{t('health.networkEgress')}</h2>
            <p className="subtle">{t('health.networkEgressDescription')}</p>
          </div>
          {!modelPage || 'failed' in modelPage ? (
            <p role="status">{t('health.modelsUnavailable')}</p>
          ) : models.length === 0 ? (
            <p>{t('health.noModels')}</p>
          ) : (
            <div className="stack">
              {models.map((model) => (
                <section className="card stack" key={model.id} aria-labelledby={`health-model-${model.id}`}>
                  <div className="action-row">
                    <h3 id={`health-model-${model.id}`}>{model.displayName}</h3>
                    <Link href={`/models/${encodeURIComponent(model.id)}/network`}>
                      {t('health.openNetworkSettings')}
                    </Link>
                  </div>
                  <NetworkHealth modelId={model.id} />
                </section>
              ))}
              {nextModelCursor && (
                <Link className="btn secondary" href={`/health?modelCursor=${encodeURIComponent(nextModelCursor)}`}>
                  {t('health.nextProfiles')}
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
