import Link from 'next/link';
import PatreonManager from '@/components/PatreonManager';
import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function PatreonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const { t } = await getServerLocale();
  const canManage = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let accounts = [] as Awaited<ReturnType<typeof api.social.list>>['data'];
  try { accounts = (await api.social.list(id)).data; } catch { /* show the safe connect state */ }
  const patreon = accounts.find(account => account.platform === 'patreon');

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><h1>{t('patreon.title')}</h1><p className="subtle">{t('patreon.description')}</p></div>
        <Link className="btn secondary" href={`/models/${encodeURIComponent(id)}/network`}>{t('patreon.backToNetwork')}</Link>
      </div>
      {!patreon ? <section className="card stack">
        <h2>{t('patreon.connectTitle')}</h2>
        <p>{t('patreon.scopeDescription')}</p>
        {canManage ? <a className="btn" href={`/api/v1/connectors/patreon/authorize?modelId=${encodeURIComponent(id)}`}>{t('patreon.connectAction')}</a> : <p className="subtle">{t('patreon.connectRequiresRole')}</p>}
      </section> : <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><h2>{patreon.displayName}</h2><span className="badge good">{patreon.status}</span></div>
        <PatreonManager connectionId={patreon.id} />
      </section>}
    </div>
  );
}
