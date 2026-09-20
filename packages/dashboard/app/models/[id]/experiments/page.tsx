import { api, getSession } from '@/lib/api';
import VariantExperimentManager from '@/components/VariantExperimentManager';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function VariantExperimentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const { t } = await getServerLocale();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const [experiments, candidates] = await Promise.all([api.models.variantExperiments(id), api.models.variantCandidates(id)]);
    return <div className="page-stack"><h2>{t('experiments.title')}</h2><div className="card"><VariantExperimentManager modelId={id} experiments={experiments.data} candidates={candidates.data} nextCursor={candidates.meta.next_cursor} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>{t('experiments.unavailableTitle')}</h2><p>{t('experiments.loadFailed')}</p></div>;
  }
}
