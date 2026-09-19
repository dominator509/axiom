import Link from 'next/link';
import PlatformAffiliateManager from '@/components/PlatformAffiliateManager';
import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function AffiliatePage() {
  const session = await getSession();
  const { t } = await getServerLocale();
  if (session?.user?.role !== 'owner') {
    return (
      <section className="card stack" role="alert">
        <h1>{t('affiliate.accessTitle')}</h1>
        <p>{t('affiliate.accessDescription')}</p>
        <Link href="/" className="btn secondary">{t('affiliate.backToWorkspace')}</Link>
      </section>
    );
  }

  try {
    const snapshot = (await api.platformAffiliate.getProgram()).data;
    return <PlatformAffiliateManager initial={snapshot} />;
  } catch {
    return (
      <section className="card stack" role="alert">
        <h1>{t('affiliate.title')}</h1>
        <p>{t('affiliate.loadFailed')}</p>
      </section>
    );
  }
}
