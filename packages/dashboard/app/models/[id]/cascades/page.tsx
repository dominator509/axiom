import { api, getSession } from '@/lib/api';
import CascadeTemplateManager from '@/components/CascadeTemplateManager';

export const dynamic = 'force-dynamic';

export default async function CascadeTemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const templates = (await api.models.cascadeTemplates(id)).data;
    return <div className="page-stack"><h2>Cascade schedules</h2><div className="card"><CascadeTemplateManager modelId={id} templates={templates} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>Cascade schedules unavailable</h2><p>Templates could not be loaded. No scheduled target was changed.</p></div>;
  }
}
