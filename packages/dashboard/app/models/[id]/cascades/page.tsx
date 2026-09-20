import { api, getSession } from '@/lib/api';
import CascadeTemplateManager from '@/components/CascadeTemplateManager';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function CascadeTemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const { t } = await getServerLocale();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const templates = (await api.models.cascadeTemplates(id)).data;
    return <div className="page-stack"><h2>{t('cascades.title')}</h2><div className="card"><CascadeTemplateManager modelId={id} templates={templates} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('cascades.unavailableTitle')}</h2><p>{t('cascades.loadFailed')}</p></div>;
  }
}
