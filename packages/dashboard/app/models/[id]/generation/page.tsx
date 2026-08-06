import GenerateForm from '@/components/GenerateForm';

export const dynamic = 'force-dynamic';

export default async function GenerationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <GenerateForm modelId={id} />
    </div>
  );
}
