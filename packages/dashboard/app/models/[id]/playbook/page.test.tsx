import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ guidelines: vi.fn(), score: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: 'owner' } }), api: { models: { playbookGuidelines: mocks.guidelines, playbookScore: mocks.score } } }));
vi.mock('@/components/PlaybookGuidelineManager', () => ({ default: () => <div>Guideline editor and history</div> }));
import Page from './page';
beforeEach(() => { mocks.guidelines.mockReset(); mocks.score.mockReset(); });
it('keeps guidelines accessible when the independent score service fails', async () => {
  mocks.guidelines.mockResolvedValue({ data: [] }); mocks.score.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('Score unavailable'); expect(html).toContain('Guideline editor and history');
});
it('does not replace a failed guideline read with an editable empty default', async () => {
  mocks.guidelines.mockRejectedValue(new Error('private error')); mocks.score.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('Reload before editing'); expect(html).not.toContain('Guideline editor and history'); expect(html).not.toContain('private error');
});
