import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';
const mocks = vi.hoisted(() => ({ guidelines: vi.fn(), score: vi.fn(), getServerLocale: vi.fn(), role: 'owner' }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: mocks.role } }), api: { models: { playbookGuidelines: mocks.guidelines, playbookScore: mocks.score } } }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: mocks.getServerLocale }));
vi.mock('@/components/PlaybookGuidelineManager', () => ({ default: ({ canEdit }: { canEdit: boolean }) => <div data-editable={String(canEdit)}>Guideline editor and history</div> }));
import Page from './page';
const catalog = new LocaleCatalog(CATALOGS);
const localeFor = (locale: SupportedLocale) => ({
  locale,
  t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
  dateTime: (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(typeof value === 'string' ? new Date(value) : value),
});
beforeEach(() => { mocks.role = 'owner'; mocks.guidelines.mockReset(); mocks.score.mockReset(); mocks.getServerLocale.mockReset(); mocks.getServerLocale.mockResolvedValue(localeFor('en')); });
it('keeps creator guidelines read-only while loading score evidence', async () => {
  mocks.role = 'content_creator'; mocks.guidelines.mockResolvedValue({ data: [] });
  mocks.score.mockResolvedValue({ data: { score: { overall: 0.25, passed: false }, history: [], cadencePerDay: 1, postCount30d: 30, scheduleCount30d: 30 } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('25%'); expect(html).toContain('data-editable="false"');
});
it('formats playbook score, cadence and counts in the selected locale', async () => {
  mocks.getServerLocale.mockResolvedValue(localeFor('de'));
  mocks.guidelines.mockResolvedValue({ data: [] });
  mocks.score.mockResolvedValue({ data: {
    score: { overall: 0.25, passed: false },
    history: [{ id: 'history', score: 98, ts: '2026-09-15T12:00:00Z' }],
    cadencePerDay: 1234.5,
    postCount30d: 12345,
    scheduleCount30d: 6789,
  } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('25%');
  expect(html).toContain('1.234,50');
  expect(html).toContain('12.345');
  expect(html).toContain('6.789');
  expect(html).toContain('98%');
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
