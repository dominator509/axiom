import GenerateForm from '@/components/GenerateForm';
import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function GenerationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const { t } = await getServerLocale();
  const role = (await getSession())?.user?.role;
  if (!['owner', 'manager', 'operator', 'content_creator'].includes(role ?? '')) return (
    <div className="card"><h2>{t('modelSurface.generationAccessUnavailable')}</h2><p>{t('modelSurface.generationRoleDenied')}</p><Link href="/">{t('modelSurface.backToWorkspace')}</Link></div>
  );
  let veniceAvailable = false;
  try {
    veniceAvailable = (await api.llm.providers()).capabilities.some(
      capability => capability.provider === 'venice' && capability.available,
    );
  } catch {
    // Provider choice stays automatic when the gateway capability state is unavailable.
  }
  const query = await searchParams;
  const sourceAssetId = typeof query?.sourceAssetId === 'string' && /^[0-9a-f-]{36}$/i.test(query.sourceAssetId) ? query.sourceAssetId : undefined;
  return (
    <div>
      <GenerateForm modelId={id} initialSourceAssetId={sourceAssetId} operatorControls={role !== 'content_creator'} veniceAvailable={veniceAvailable} />
    </div>
  );
}
