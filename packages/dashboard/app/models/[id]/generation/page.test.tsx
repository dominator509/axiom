import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const session = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ getSession: session }));
beforeEach(() => session.mockResolvedValue({ user: { role: 'owner' } }));
vi.mock('@/components/GenerateForm', () => ({ default: ({ modelId, initialSourceAssetId, operatorControls }: { modelId: string; initialSourceAssetId?: string; operatorControls: boolean }) => <div data-model={modelId} data-source={initialSourceAssetId ?? ''} data-operator={String(operatorControls)} /> }));
import GenerationPage from './page';
it('forwards only a valid selected source asset to the generator', async () => {
  expect(renderToStaticMarkup(await GenerationPage({ params: Promise.resolve({ id: 'model' }), searchParams: Promise.resolve({ sourceAssetId: '11111111-1111-4111-8111-111111111111' }) }))).toContain('data-source="11111111-1111-4111-8111-111111111111"');
  expect(renderToStaticMarkup(await GenerationPage({ params: Promise.resolve({ id: 'model' }), searchParams: Promise.resolve({ sourceAssetId: ['one', 'two'] }) }))).toContain('data-source=""');
});
it.each(['analyst', 'agent', 'model', 'chatter', undefined])('excludes generation controls for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await GenerationPage({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('Generation access unavailable');
  expect(html).not.toContain('data-model');
});
it('keeps creator preparation separate from operator controls', async () => {
  session.mockResolvedValue({ user: { role: 'content_creator' } });
  expect(renderToStaticMarkup(await GenerationPage({ params: Promise.resolve({ id: 'model' }) }))).toContain('data-operator="false"');
});
