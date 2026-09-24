import { api, getSession } from '@/lib/api';
import TriggerRuleManager from '@/components/TriggerRuleManager';
import CommentModerationPanel from '@/components/CommentModerationPanel';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function TriggerRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getServerLocale();
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const [rulesResult, socialResult] = await Promise.all([api.models.triggerRules(id), api.social.list(id)]);
    return <div className="page-stack"><h2>{t('automation.title')}</h2><div className="card"><TriggerRuleManager modelId={id} rules={rulesResult.data} canEdit={canEdit} /></div><CommentModerationPanel modelId={id} connections={socialResult.data} canEdit={canEdit} /></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('automation.title')}</h2><p>{t('automation.loadFailed')} {t('automation.noStateChanged')}</p></div>;
  }
}
