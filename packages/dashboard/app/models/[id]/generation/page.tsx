import GenerateForm from '@/components/GenerateForm';

export const dynamic = 'force-dynamic';

export default async function GenerationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const sourceAssetId = typeof query?.sourceAssetId === 'string' && /^[0-9a-f-]{36}$/i.test(query.sourceAssetId) ? query.sourceAssetId : undefined;
  return (
    <div>
      <GenerateForm modelId={id} initialSourceAssetId={sourceAssetId} />
    </div>
  );
}
