import { api, getSession } from '@/lib/api';
import AgentPermissionManager from '@/components/AgentPermissionManager';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function AgentPermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getServerLocale();
  const session = await getSession();
  const canEdit = session?.user?.role === 'owner';
  try {
    const permissions = (await api.models.agentPermissions(id)).data;
    return <div className="page-stack"><h2>{t('agent.accessTitle')}</h2><div className="card"><AgentPermissionManager modelId={id} permissions={permissions} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('agent.accessUnavailable')}</h2><p>{t('agent.loadFailed')} {t('agent.noStateChanged')}</p></div>;
  }
}
