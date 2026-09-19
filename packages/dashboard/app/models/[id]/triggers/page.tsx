import { api, getSession } from '@/lib/api';
import TriggerRuleManager from '@/components/TriggerRuleManager';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function TriggerRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getServerLocale();
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const rules = (await api.models.triggerRules(id)).data;
    return <div className="page-stack"><h2>{t('automation.title')}</h2><div className="card"><TriggerRuleManager modelId={id} rules={rules} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('automation.title')}</h2><p>{t('automation.loadFailed')} {t('automation.noStateChanged')}</p></div>;
  }
}
