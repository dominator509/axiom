import GenerateForm from '@/components/GenerateForm';
import { getSession } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function GenerationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const role = (await getSession())?.user?.role;
  if (!['owner', 'manager', 'operator', 'content_creator'].includes(role ?? '')) return (
    <div className="card"><h2>Generation access unavailable</h2><p>Your role does not allow creating or uploading media.</p><Link href="/">Back to workspace</Link></div>
  );
  const query = await searchParams;
  const sourceAssetId = typeof query?.sourceAssetId === 'string' && /^[0-9a-f-]{36}$/i.test(query.sourceAssetId) ? query.sourceAssetId : undefined;
  return (
    <div>
      <GenerateForm modelId={id} initialSourceAssetId={sourceAssetId} operatorControls={role !== 'content_creator'} />
    </div>
  );
}
