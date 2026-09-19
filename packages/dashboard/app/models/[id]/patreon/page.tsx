import Link from 'next/link';
import PatreonManager from '@/components/PatreonManager';
import { api, getSession } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function PatreonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canManage = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let accounts = [] as Awaited<ReturnType<typeof api.social.list>>['data'];
  try { accounts = (await api.social.list(id)).data; } catch { /* show the safe connect state */ }
  const patreon = accounts.find(account => account.platform === 'patreon');

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><h1>Patreon community</h1><p className="subtle">Read-only creator community sync for campaigns, memberships and posts.</p></div>
        <Link className="btn secondary" href={`/models/${encodeURIComponent(id)}/network`}>Back to network</Link>
      </div>
      {!patreon ? <section className="card stack">
        <h2>Connect Patreon</h2>
        <p>AXIOM requests only the documented v2 identity, campaign, membership, post-read and webhook scopes. It never requests member email/address scopes by default.</p>
        {canManage ? <a className="btn" href={`/api/v1/connectors/patreon/authorize?modelId=${encodeURIComponent(id)}`}>Connect Patreon</a> : <p className="subtle">Connecting accounts requires an owner, manager or operator role.</p>}
      </section> : <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><h2>{patreon.displayName}</h2><span className="badge good">{patreon.status}</span></div>
        <PatreonManager connectionId={patreon.id} />
      </section>}
    </div>
  );
}
