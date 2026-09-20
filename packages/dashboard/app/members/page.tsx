import Link from 'next/link';
import { getSession } from '@/lib/api';
import WorkspaceMembers from '@/components/WorkspaceMembers';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const session = await getSession();
  const { t } = await getServerLocale();
  if (session?.user?.role !== 'owner') return <div className="card stack"><h1>{t('members.title')}</h1><p>{t('members.accessDescription')}</p><Link href="/" className="btn secondary">{t('members.backToWorkspace')}</Link></div>;
  return <div className="page-stack"><h1>{t('members.title')}</h1><p>{t('members.description')}</p><p>{t('members.scopeNote')}</p><WorkspaceMembers /></div>;
}
