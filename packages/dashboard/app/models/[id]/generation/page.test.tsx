import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/components/GenerateForm', () => ({ default: ({ modelId, initialSourceAssetId }: { modelId: string; initialSourceAssetId?: string }) => <div data-model={modelId} data-source={initialSourceAssetId ?? ''} /> }));
import GenerationPage from './page';
it('forwards only a valid selected source asset to the generator', async () => {
  expect(renderToStaticMarkup(await GenerationPage({ params: Promise.resolve({ id: 'model' }), searchParams: Promise.resolve({ sourceAssetId: '11111111-1111-4111-8111-111111111111' }) }))).toContain('data-source="11111111-1111-4111-8111-111111111111"');
  expect(renderToStaticMarkup(await GenerationPage({ params: Promise.resolve({ id: 'model' }), searchParams: Promise.resolve({ sourceAssetId: ['one', 'two'] }) }))).toContain('data-source=""');
});
