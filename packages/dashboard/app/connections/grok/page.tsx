import GrokConnection from '@/components/GrokConnection';
import GrokR2Storage from '@/components/GrokR2Storage';
import SubscriptionConnections from '@/components/SubscriptionConnections';
import Link from 'next/link';
import { getSession } from '@/lib/api';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function GrokConnectionPage() {
  const role = (await getSession())?.user?.role;
  const { t } = await getServerLocale();
  if (!workspaceDestinationAllowed(role, '/connections/grok')) return <section className="card stack">
    <h1>{t('connection.accessTitle')}</h1><p>{t('connection.accessDescription')}</p>
    <Link href="/" className="btn secondary">{t('connection.backToWorkspace')}</Link>
  </section>;
  return <section className="stack">
    <h1>{t('connection.grokTitle')}</h1>
    <p>{t('connection.grokDescription')}</p>
    <GrokConnection />
    <SubscriptionConnections />
    <p>{t('connection.storagePrivacyNote')}</p>
    <GrokR2Storage />
  </section>;
}
