import { api, getSession } from '@/lib/api';
import AgentPermissionManager from '@/components/AgentPermissionManager';

export const dynamic = 'force-dynamic';

export default async function AgentPermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = session?.user?.role === 'owner';
  try {
    const permissions = (await api.models.agentPermissions(id)).data;
    return <div className="page-stack"><h2>Agent access</h2><div className="card"><AgentPermissionManager modelId={id} permissions={permissions} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>Agent access unavailable</h2><p>Agent grants could not be loaded. No permission or token state was changed.</p></div>;
  }
}
