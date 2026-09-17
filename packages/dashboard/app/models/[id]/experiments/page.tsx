import { api, getSession } from '@/lib/api';
import VariantExperimentManager from '@/components/VariantExperimentManager';

export const dynamic = 'force-dynamic';

export default async function VariantExperimentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  try {
    const experiments = (await api.models.variantExperiments(id)).data;
    return <div className="page-stack"><h2>Variant experiments</h2><div className="card"><VariantExperimentManager modelId={id} experiments={experiments} canEdit={canEdit} /></div></div>;
  } catch {
    return <div className="card stack" role="alert"><h2>Variant experiments unavailable</h2><p>Experiments could not be loaded. No experiment state was changed.</p></div>;
  }
}
