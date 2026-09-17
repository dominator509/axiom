import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), bundles: vi.fn(), connections: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { bundles: { list: mocks.bundles }, social: { list: mocks.connections } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import Page from './page';
const id = '11111111-1111-4111-8111-111111111111';
const caption = 'A question?';
const bundle = { id, modelId: id, orgId: id, captions: { instagram: caption }, hashtags: [], assetId: null,
  state: 'generated', tosReport: null, createdAt: '2026-09-17T00:00:00Z',
  captionGuidance: { instagram: { version: 'caption-guidance-v1', selectedArm: 'short:question',
    context: 'learn-v1:scheduled-utc-unknown', exemplarIds: [id], captionSha256: createHash('sha256').update(caption).digest('hex') } } };
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { role: 'owner' } });
  mocks.connections.mockResolvedValue({ data: [] });
  mocks.bundles.mockImplementation(async (_id: string, state: string) => ({ data: state === 'generated' ? [bundle] : [] }));
});
it('wires saved guidance into the real approval page without exposing hashes', async () => {
  const html = await render();
  expect(html).toContain('<summary>Caption guidance</summary>');
  expect(html).toContain('Short caption with a question');
  expect(html).not.toContain(bundle.captionGuidance.instagram.captionSha256);
});
it('shows a changed-caption warning for saved edits', async () => {
  mocks.bundles.mockImplementation(async (_id: string, state: string) => ({ data: state === 'generated' ? [{ ...bundle, captions: { instagram: 'Edited' } }] : [] }));
  expect(await render()).toContain('Caption changed since generation');
});
it('allows agents to inspect guidance without loading publication accounts', async () => {
  mocks.session.mockResolvedValue({ user: { role: 'agent' } });
  const html = await render();
  expect(html).toContain('Review drafts');
  expect(html).toContain('<summary>Caption guidance</summary>');
  expect(html).not.toContain('Caption revision instructions');
  expect(mocks.connections).not.toHaveBeenCalled();
});
it('denies unsupported roles before loading any bundle or connection', async () => {
  mocks.session.mockResolvedValue({ user: { role: 'unknown' } });
  expect(await render()).toContain('Review access unavailable');
  expect(mocks.bundles).not.toHaveBeenCalled();
  expect(mocks.connections).not.toHaveBeenCalled();
});
