import { api, getSession } from '@/lib/api';
import TeamOperationsManager from '@/components/TeamOperationsManager';
import ModelAssignments from '@/components/ModelAssignments';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const { t } = await getServerLocale();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const operations = (await api.models.teamOperations(id)).data;
    return <div className="page-stack"><h2>{t('team.pageTitle')}</h2>{session?.user?.role === 'owner' && <ModelAssignments key={id} modelId={id} members={operations.members} />}<div className="card"><TeamOperationsManager modelId={id} {...operations} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('team.unavailableTitle')}</h2><p>{t('team.loadFailed')}</p></div>;
  }
}
