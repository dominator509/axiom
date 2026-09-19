import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const list = vi.hoisted(() => vi.fn());
const operations = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  api: { models: { media: list, mediaOperations: operations } },
  getSession,
}));
import MediaPage from './page';
vi.mock('@/components/MediaOperationControls', () => ({ default: ({ canEdit }: { canEdit: boolean }) => <div>{canEdit ? 'Transform controls' : 'Transform history'}</div> }));
vi.mock('@/components/MediaBundleCreate', () => ({ default: () => <div>Stage bundle controls</div> }));
vi.mock('@/components/CopyVariantCreate', () => ({ default: () => <div>Variant controls</div> }));
beforeEach(() => {
  list.mockReset();
  operations.mockReset();
  operations.mockResolvedValue({ data: [] });
  getSession.mockResolvedValue({ user: { role: 'operator' } });
});
it('renders authenticated image/video previews and model-scoped pagination', async () => {
  list.mockResolvedValue({ data: [
    { id: 'image', kind: 'image', mimeType: 'image/png', fileSize: 2048, width: 864, height: 1152, createdAt: '2026-09-15', status: 'running', operationId: 'operation', resultAssetIds: ['video'] },
    { id: 'video', kind: 'video', mimeType: 'video/mp4', fileSize: 4096, createdAt: '2026-09-15', status: 'unknown', sourceAssetId: 'image', resultAssetIds: [] },
  ], meta: { next_cursor: 'next token' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ cursor: 'current' }) }));
  expect(list).toHaveBeenCalledWith('talent', 'current');
  expect(html).toContain('/api/v1/models/talent/media/image');
  expect(html).toContain('Saved video'); expect(html).toContain('Loading media preview');
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
  expect(html).toContain('Showing uploaded · image.');
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
