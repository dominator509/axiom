import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
const state = vi.hoisted(() => ({ role: 'operator', list: vi.fn(), locale: 'en' }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: state.role } }), api: { digests: { list: state.list }, uiLocale: { get: async () => ({ data: { locale: state.locale } }) } } }));
vi.mock('@/components/GenerateDigestButton', () => ({ default: () => <button>Generate this week</button> }));
import DigestsPage from './page';
const catalog = new LocaleCatalog(CATALOGS);
beforeEach(() => { state.role = 'operator'; state.locale = 'en'; state.list.mockReset().mockResolvedValue({ data: [{ id: 'digest', title: 'Week 1', description: 'Summary', state: 'sent', createdAt: '2026-09-15', config: {} }], meta: { next_cursor: 'next' } }); });
it('renders digest cards, queue control and pagination', async () => {
  const html = renderToStaticMarkup(await DigestsPage({ searchParams: Promise.resolve({ cursor: 'current' }) }));
  expect(state.list).toHaveBeenCalledWith('current'); expect(html).toContain('Week 1'); expect(html).toContain('Generate this week'); expect(html).toContain('/digests?cursor=next');
});
it('hides queue control from read-only roles and does not disguise failure as empty', async () => {
  state.role = 'viewer'; state.list.mockRejectedValue(new Error('down')); const html = renderToStaticMarkup(await DigestsPage({}));
  expect(html).not.toContain('Generate this week'); expect(html).toContain('could not be loaded');
});
it('links settings only for the owner who can actually access that page', async () => {
  state.role = 'manager';
  expect(renderToStaticMarkup(await DigestsPage({}))).not.toContain('Manage weekly digest settings');
  state.role = 'owner';
  expect(renderToStaticMarkup(await DigestsPage({}))).toContain('Manage weekly digest settings');
});
it('renders the page in the persisted non-English locale', async () => {
  state.locale = 'de';
  const html = renderToStaticMarkup(await DigestsPage({}));
  expect(html).toContain(catalog.t('de', 'digest.title'));
  expect(html).toContain(catalog.t('de', 'digest.older'));
  expect(html).not.toContain(catalog.t('en', 'digest.title'));
  // Creator-authored digest content is not translated.
  expect(html).toContain('Week 1');
});
it('renders truthful stored-vs-external delivery wording from the API field', async () => {
  state.list.mockResolvedValue({ data: [
    { id: 'a', title: 'A', description: null, state: 'sent', createdAt: '2026-09-15', config: {}, externalDelivery: 'not-attempted' },
    { id: 'b', title: 'B', description: null, state: 'sent', createdAt: '2026-09-15', config: {}, externalDelivery: 'attempted' },
    { id: 'c', title: 'C', description: null, state: 'sent', createdAt: '2026-09-15', config: {} },
  ], meta: { next_cursor: null } });
  const html = renderToStaticMarkup(await DigestsPage({}));
  expect(html).toContain('Stored only');
  expect(html).toContain('Dispatch attempted');
  expect(html).toContain('Outcome unknown');
});
