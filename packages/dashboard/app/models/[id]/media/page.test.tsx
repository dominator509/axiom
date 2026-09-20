import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
const list = vi.hoisted(() => vi.fn());
const operations = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const getServerLocale = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  api: { models: { media: list, mediaOperations: operations } },
  getSession,
}));
vi.mock('@/lib/server-locale', () => ({ getServerLocale }));
import MediaPage from './page';
vi.mock('@/components/MediaOperationControls', () => ({ default: ({ canEdit }: { canEdit: boolean }) => <div>{canEdit ? 'Transform controls' : 'Transform history'}</div> }));
vi.mock('@/components/MediaBundleCreate', () => ({ default: () => <div>Stage bundle controls</div> }));
vi.mock('@/components/CopyVariantCreate', () => ({ default: () => <div>Variant controls</div> }));

const catalog = new LocaleCatalog(CATALOGS);

/** Render the real page component through a persisted non-English locale. */
function localeFor(locale: 'en' | 'es' | 'ja' | 'it' | 'pt-BR' | 'de') {
  return {
    locale,
    t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
    dateTime: (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
      .format(typeof value === 'string' ? new Date(value) : value),
  };
}

const asset = (overrides: Record<string, unknown>) => ({
  id: 'asset', kind: 'image', mimeType: 'image/png', fileSize: 2048, createdAt: '2026-09-15', ...overrides,
});

beforeEach(() => {
  list.mockReset();
  operations.mockReset();
  getServerLocale.mockReset();
  operations.mockResolvedValue({ data: [] });
  getSession.mockResolvedValue({ user: { role: 'operator' } });
  getServerLocale.mockResolvedValue(localeFor('en'));
});

it('renders authenticated image/video previews and model-scoped pagination', async () => {
  list.mockResolvedValue({ data: [
    { id: 'image', kind: 'image', mimeType: 'image/png', fileSize: 2048, width: 864, height: 1152, createdAt: '2026-09-15', status: 'running', operationId: 'operation', resultAssetIds: ['video'] },
    { id: 'video', kind: 'video', mimeType: 'video/mp4', fileSize: 4096, createdAt: '2026-09-15', status: 'unknown', sourceAssetId: 'image', resultAssetIds: [] },
  ], meta: { next_cursor: 'next token' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ cursor: 'current' }) }));
  expect(list).toHaveBeenCalledWith('talent', 'current');
  expect(html).toContain('/api/v1/models/talent/media/image');
  expect(html).toContain('Saved Videos'); expect(html).toContain('Loading media preview');
  expect(html).toContain('Processing'); expect(html).toContain('1 saved result'); expect(html).toContain('Derived from source media');
  expect(html).toContain('/models/talent/media?cursor=next+token');
  expect(html).toContain('/models/talent/generation?sourceAssetId=image');
  expect(html).toContain('does not mean an asset passed review');
  expect(html).toContain('Upload source media');
});

it('passes validated filters to the API and preserves them across pagination', async () => {
  list.mockResolvedValue({ data: [{ id: 'image', kind: 'image', origin: 'uploaded', fileSize: 2048 }], meta: { next_cursor: 'older' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ origin: 'uploaded', kind: 'image' }) }));
  expect(list).toHaveBeenCalledWith('talent', undefined, { origin: 'uploaded', kind: 'image' });
  expect(html).toContain('Showing Uploaded source · Images.');
  expect(html).toContain('/models/talent/media?cursor=older&amp;origin=uploaded&amp;kind=image');
  expect(html).toContain('Clear filters');
});

it('does not disguise an API failure as an empty library', async () => {
  list.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('No saved media');
});

it.each(['content_creator', 'model', 'analyst', 'agent'])('renders usable media for %s without unauthorized actions', async role => {
  getSession.mockResolvedValue({ user: { role } });
  list.mockResolvedValue({ data: [{ id: 'image', kind: 'image', fileSize: 2048 }], meta: { next_cursor: 'older' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('Loading media preview');
  expect(html).toContain('Older media');
  expect(html.includes('Stage bundle controls')).toBe(role === 'content_creator');
  expect(html.includes('Transform controls')).toBe(role === 'content_creator');
  expect(html.includes('Use for video')).toBe(role === 'content_creator');
  expect(html.includes('Upload source media')).toBe(role === 'content_creator');
  expect(html).not.toContain('Variant controls');
  expect(operations).toHaveBeenCalledTimes(role === 'model' ? 0 : 1);
});

it('retains saved media when transformation history is unavailable', async () => {
  list.mockResolvedValue({ data: [{ id: 'image', kind: 'image', fileSize: 2048 }] });
  operations.mockRejectedValue(new Error('forbidden'));
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('Transformation status could not be loaded');
  expect(html).toContain('Loading media preview');
  expect(html).not.toContain('Transform controls');
});

it.each(['chatter', 'unknown', undefined])('does not query media for excluded role %s', async role => {
  getSession.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('Media access unavailable');
  expect(list).not.toHaveBeenCalled(); expect(operations).not.toHaveBeenCalled();
});

// ─── MEDIA-LOCALE-SHELL-CURRENT-R1 localization coverage ─────────────────────

it.each(['es', 'ja', 'it', 'pt-BR', 'de'] as const)('renders persisted %s UI copy through the real server page', async locale => {
  getServerLocale.mockResolvedValue(localeFor(locale));
  getSession.mockResolvedValue({ user: { role: 'operator' } });
  list.mockResolvedValue({ data: [asset({ id: 'image' })], meta: { next_cursor: 'older' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ origin: 'uploaded', kind: 'image' }) }));
  // Every localized literal comes from the persisted catalog, not English.
  expect(html).toContain(CATALOGS[locale]['media.title']);
  expect(html).toContain(CATALOGS[locale]['media.description']);
  expect(html).toContain(CATALOGS[locale]['media.filterTitle']);
  expect(html).toContain(CATALOGS[locale]['media.originUploaded']);
  expect(html).toContain(CATALOGS[locale]['media.applyFilters']);
  expect(html).toContain(CATALOGS[locale]['media.older']);
  expect(html).toContain(CATALOGS[locale]['media.assetTitleUploaded']);
  expect(html).toContain(CATALOGS[locale]['media.openSaved']);
  expect(html).not.toContain('Media library');
  expect(html).not.toContain('Older media');
});

it('renders the applied-filter summary and pagination labels in the persisted locale', async () => {
  getServerLocale.mockResolvedValue(localeFor('de'));
  list.mockResolvedValue({ data: [asset({ id: 'image', origin: 'transformed' })], meta: { next_cursor: 'older' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ origin: 'transformed', kind: 'video' }) }));
  expect(html).toContain(CATALOGS.de['media.showingFilters']
    .replace('{origin}', CATALOGS.de['media.originTransformed'])
    .replace('{kind}', CATALOGS.de['media.kindVideo']));
  expect(html).toContain(CATALOGS.de['media.assetTitleTransformed']);
  expect(html).toContain('/models/talent/media?cursor=older&amp;origin=transformed&amp;kind=video');
});

it.each(['es', 'ja', 'it', 'pt-BR', 'de'] as const)('localizes the denied-role shell for %s', async locale => {
  getServerLocale.mockResolvedValue(localeFor(locale));
  getSession.mockResolvedValue({ user: { role: 'chatter' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(CATALOGS[locale]['media.accessUnavailable']);
  expect(html).toContain(CATALOGS[locale]['media.back']);
  expect(html).not.toContain('Media access unavailable');
  expect(list).not.toHaveBeenCalled();
});

it.each(['es', 'ja', 'de'] as const)('localizes load-failure and empty states for %s', async locale => {
  getServerLocale.mockResolvedValue(localeFor(locale));
  list.mockRejectedValue(new Error('unavailable'));
  const failed = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(failed).toContain(CATALOGS[locale]['media.loadFailed']);
  expect(failed).not.toContain('Media could not be loaded');

  list.mockReset();
  list.mockResolvedValue({ data: [] });
  const empty = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(empty).toContain(CATALOGS[locale]['media.emptyPage']);
  expect(empty).not.toContain('No saved media in this page');
});

it('localizes the operation-unavailable notice without hiding saved media', async () => {
  getServerLocale.mockResolvedValue(localeFor('pt-BR'));
  list.mockResolvedValue({ data: [asset({ id: 'image' })] });
  operations.mockRejectedValue(new Error('forbidden'));
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(CATALOGS['pt-BR']['media.operationsLoadFailed']);
  expect(html).toContain('Loading media preview');
  expect(html).not.toContain('Transform controls');
});

it.each([
  ['image', 'uploaded', 'media.assetTitleUploaded', 'media.kindImage'],
  ['video', 'generated', 'media.assetTitleGenerated', 'media.kindVideo'],
  ['image', 'transformed', 'media.assetTitleTransformed', 'media.kindImage'],
  ['image', 'legacy', 'media.assetTitleSaved', 'media.kindImage'],
] as const)('localizes the %s/%s asset title and kind label in ja', async (kind, origin, titleKey, kindKey) => {
  getServerLocale.mockResolvedValue(localeFor('ja'));
  list.mockResolvedValue({ data: [{ id: 'asset', kind, origin, fileSize: 1024, status: 'unknown' }] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(`${CATALOGS.ja[titleKey]} ${CATALOGS.ja[kindKey]}`);
});

it.each([
  ['queued', 'warn', 'media.lifecycleQueued'],
  ['running', 'warn', 'media.lifecycleRunning'],
  ['failed', 'bad', 'media.lifecycleFailed'],
  ['completed', 'good', 'media.lifecycleCompleted'],
] as const)('localizes the %s lifecycle label and detail in es', async (status, tone, key) => {
  getServerLocale.mockResolvedValue(localeFor('es'));
  list.mockResolvedValue({ data: [{ id: 'asset', kind: 'image', fileSize: 1024, status, operationId: 'op' }] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(CATALOGS.es[key]);
  expect(html).toContain(CATALOGS.es[`${key}Detail`]);
  expect(html).toContain(`badge ${tone}`);
});

it('localizes the source/result relationship labels without translating the asset IDs', async () => {
  getServerLocale.mockResolvedValue(localeFor('it'));
  list.mockResolvedValue({ data: [
    { id: 'source-asset-id', kind: 'image', fileSize: 1024, status: 'completed', operationId: 'op', resultAssetIds: ['result-asset-id'] },
    { id: 'result-asset-id', kind: 'image', fileSize: 1024, status: 'completed', operationId: 'op', sourceAssetId: 'source-asset-id' },
  ] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(CATALOGS.it['media.derivedFromSource']);
  expect(html).toContain(CATALOGS.it['media.resultCountOne'].replace('{count}', '1'));
  // Raw asset IDs stay verbatim data.
  expect(html).toContain('#media-source-asset-id');
  expect(html).toContain('#media-result-asset-id');
});

it('localizes the summary noun in the plural result count', async () => {
  getServerLocale.mockResolvedValue(localeFor('de'));
  list.mockResolvedValue({ data: [
    { id: 'a', kind: 'image', fileSize: 1024, status: 'completed', operationId: 'op', resultAssetIds: ['b', 'c'] },
    { id: 'b', kind: 'image', fileSize: 1024 },
    { id: 'c', kind: 'image', fileSize: 1024 },
  ] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(CATALOGS.de['media.resultCountMany'].replace('{count}', '2'));
  expect(html).not.toContain('2 saved results');
});

it('formats the saved createdAt with the locale-aware dateTime formatter, not a raw date', async () => {
  getServerLocale.mockResolvedValue(localeFor('de'));
  list.mockResolvedValue({ data: [{ id: 'asset', kind: 'image', fileSize: 1024, status: 'unknown', createdAt: '2026-09-15T12:00:00Z' }] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  const expected = new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date('2026-09-15T12:00:00Z'));
  expect(html).toContain(expected);
  expect(html).not.toContain('2026-09-15T12:00:00Z');
});

it('does not translate provider/user-authored content or raw media metadata', async () => {
  getServerLocale.mockResolvedValue(localeFor('ja'));
  list.mockResolvedValue({ data: [{
    id: 'asset-id-123', kind: 'video', origin: 'uploaded', mimeType: 'video/mp4', fileSize: 3 * 1024 * 1024,
    width: 1920, height: 1080, createdAt: '2026-09-15T12:00:00Z', status: 'running', operationId: 'op',
    assetTitle: 'Explicit provider title — do not translate',
  }] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  // Locale-aware dimension separator is used, and the raw metadata values survive.
  expect(html).toContain('1920 × 1080');
  expect(html).toContain('3072 KB');
  expect(html).toContain('asset-id-123');
  // The page shell copy is Japanese.
  expect(html).toContain(CATALOGS.ja['media.title']);
});

it('keeps the safety wording and role gates truthful under a non-English locale', async () => {
  getServerLocale.mockResolvedValue(localeFor('es'));
  getSession.mockResolvedValue({ user: { role: 'model' } });
  list.mockResolvedValue({ data: [asset({ id: 'image' })] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain(CATALOGS.es['media.description']);
  expect(operations).not.toHaveBeenCalled();
  expect(html).not.toContain('Transform controls');
  expect(html.includes('Use for video')).toBe(false);
  expect(html.includes('Variant controls')).toBe(false);
});

it('falls back to English when the locale preference is unavailable', async () => {
  getServerLocale.mockResolvedValue(localeFor('en'));
  list.mockResolvedValue({ data: [asset({ id: 'image' })] });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('Media library');
  expect(html).toContain('Open saved media');
});
