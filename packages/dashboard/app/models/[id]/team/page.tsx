import { api, getSession } from '@/lib/api';
import TeamOperationsManager from '@/components/TeamOperationsManager';
import ModelAssignments from '@/components/ModelAssignments';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const operations = (await api.models.teamOperations(id)).data;
    return <div className="page-stack"><h2>Team & shifts</h2>{session?.user?.role === 'owner' && <ModelAssignments key={id} modelId={id} members={operations.members} />}<div className="card"><TeamOperationsManager modelId={id} {...operations} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>Team operations unavailable</h2><p>Team data could not be loaded. No shift or note was changed.</p></div>;
  }
}
