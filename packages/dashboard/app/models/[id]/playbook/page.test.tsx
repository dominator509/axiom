import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ guidelines: vi.fn(), score: vi.fn(), role: 'owner' }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: mocks.role } }), api: { models: { playbookGuidelines: mocks.guidelines, playbookScore: mocks.score } } }));
vi.mock('@/components/PlaybookGuidelineManager', () => ({ default: ({ canEdit }: { canEdit: boolean }) => <div data-editable={String(canEdit)}>Guideline editor and history</div> }));
import Page from './page';
beforeEach(() => { mocks.role = 'owner'; mocks.guidelines.mockReset(); mocks.score.mockReset(); });
it('keeps creator guidelines read-only while loading score evidence', async () => {
  mocks.role = 'content_creator'; mocks.guidelines.mockResolvedValue({ data: [] });
  mocks.score.mockResolvedValue({ data: { score: { overall: 0.25, passed: false }, history: [], cadencePerDay: 1, postCount30d: 30, scheduleCount30d: 30 } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('25%'); expect(html).toContain('data-editable="false"');
});
it.each(['model', 'chatter', 'unknown'])('avoids playbook queries for excluded role %s', async role => {
  mocks.role = role;
  expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }))).toContain('Playbook access unavailable');
  expect(mocks.guidelines).not.toHaveBeenCalled(); expect(mocks.score).not.toHaveBeenCalled();
});
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
