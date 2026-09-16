import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const list = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { models: { media: list } } }));
import MediaPage from './page';
beforeEach(() => { list.mockReset(); });
it('renders authenticated image/video previews and model-scoped pagination', async () => {
  list.mockResolvedValue({ data: [
    { id: 'image', kind: 'image', mimeType: 'image/png', fileSize: 2048, width: 864, height: 1152, createdAt: '2026-09-15' },
    { id: 'video', kind: 'video', mimeType: 'video/mp4', fileSize: 4096, createdAt: '2026-09-15' },
  ], meta: { next_cursor: 'next token' } });
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }), searchParams: Promise.resolve({ cursor: 'current' }) }));
  expect(list).toHaveBeenCalledWith('talent', 'current');
  expect(html).toContain('/api/v1/models/talent/media/image');
  expect(html).toContain('<video'); expect(html).toContain('playsInline');
  expect(html).toContain('/models/talent/media?cursor=next+token');
  expect(html).toContain('does not mean an asset passed review');
});
it('does not disguise an API failure as an empty library', async () => {
  list.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await MediaPage({ params: Promise.resolve({ id: 'talent' }) }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('No saved media');
});
