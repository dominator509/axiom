import Link from 'next/link';
import PlatformAffiliateManager from '@/components/PlatformAffiliateManager';
import { api, getSession } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AffiliatePage() {
  const session = await getSession();
  if (session?.user?.role !== 'owner') {
    return (
      <section className="card stack" role="alert">
        <h1>Affiliate program access</h1>
        <p>Only a FanThynks owner can manage the platform referral program.</p>
        <Link href="/" className="btn secondary">Back to workspace</Link>
      </section>
    );
  }

  try {
    const snapshot = (await api.platformAffiliate.getProgram()).data;
    return <PlatformAffiliateManager initial={snapshot} />;
  } catch {
    return (
      <section className="card stack" role="alert">
        <h1>Affiliate program</h1>
        <p>The platform referral program could not be loaded. Refresh to try again.</p>
      </section>
    );
  }
}
