import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; return hooks.slots[i] ??= { current: initial }; },
}));
import InboxAttachments, { AttachmentPreview, attachmentPreviewPath, validAttachmentReceipt } from './InboxAttachments';
const id = '11111111-1111-4111-8111-111111111111';
const scope = { modelId: id, connectionId: id, userUuid: id, messageUuid: id, mediaUuids: [id] };
const receipt = () => ({ data: { connectionId: id, userUuid: id,
  inbox: { kind: 'attachments', messageUuid: id, data: [{ uuid: id, available: true, mediaType: 'image',
    pricing: { USD: { price: 1200 } }, amountPaid: { USD: { price: 900 } }, purchasedAt: null, variants: [] }] } } });
interface Node { type: unknown; props: { children?: unknown; disabled?: boolean; role?: string; onClick?: () => Promise<void> } }
function find(value: unknown, type: string): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) { const found = find(item, type); if (found) return found; } return; }
  const node = value as Node;
  if (node.type === type) return node;
  return find(node.props?.children, type);
}
function render() { hooks.index = 0; return InboxAttachments(scope); }
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.fetch.mockReset(); vi.stubGlobal('fetch', hooks.fetch); });
afterEach(() => vi.unstubAllGlobals());
it('accepts exact receipt identities, not substituted scopes or malformed metadata', () => {
  expect(validAttachmentReceipt(receipt(), scope)).toBe(true);
  for (const key of ['connectionId', 'userUuid', 'messageUuid', 'mediaUuids'] as const)
    expect(validAttachmentReceipt(receipt(), { ...scope, [key]: key === 'mediaUuids' ? ['other'] : 'other' })).toBe(false);
  for (const patch of [{ available: 'yes' }, { mediaType: 'html' }, { variants: null }, { pricing: { USD: { price: -1 } } }]) {
    const value = receipt(); Object.assign(value.data.inbox.data[0], patch);
    expect(validAttachmentReceipt(value, scope)).toBe(false);
  }
});
it('does not load automatically and fences double clicks while retrieving the exact message', async () => {
  let resolve!: (r: Response) => void;
  hooks.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const button = find(render(), 'button')!;
  expect(hooks.fetch).not.toHaveBeenCalled();
  const first = button.props.onClick!(); const second = button.props.onClick!();
  expect(hooks.fetch).toHaveBeenCalledOnce();
  expect(find(render(), 'button')?.props.disabled).toBe(true);
  resolve(Response.json(receipt())); await Promise.all([first, second]);
  expect(find(render(), 'button')?.props.disabled).toBe(false);
  expect(JSON.stringify(render())).toContain('Amount paid: ');
  const url = new URL(hooks.fetch.mock.calls[0][0], 'https://workspace.invalid');
  expect(url.searchParams.get('messageUuid')).toBe(id);
  expect(url.searchParams.get('mediaUuids')).toBe(id);
  expect(hooks.fetch.mock.calls[0][1].cache).toBe('no-store');
});
it('clears stale metadata on a failed refresh and allows an explicit retry', async () => {
  hooks.fetch.mockResolvedValueOnce(Response.json(receipt()));
  await find(render(), 'button')!.props.onClick!();
  expect(JSON.stringify(render())).toContain('Amount paid: ');
  hooks.fetch.mockResolvedValueOnce(new Response('', { status: 403 }));
  await find(render(), 'button')!.props.onClick!();
  expect(JSON.stringify(render())).not.toContain('Amount paid: ');
  expect(JSON.stringify(render())).toContain('could not be verified');
  expect(find(render(), 'button')?.props.disabled).toBe(false);
});

const previewItem = { uuid: id, available: true, mediaType: 'video', variants: [
  { variantType: 'main', width: 720, height: 1280, lengthMs: 6000 },
] };
function preview(item = previewItem) { hooks.index = 0; return AttachmentPreview({ scope, item }); }
it('uses only same-origin scope-bound proxy URLs, never provider URLs', () => {
  const value = new URL(attachmentPreviewPath(scope, id, 'main'), 'https://workspace.invalid');
  expect(value.origin).toBe('https://workspace.invalid');
  expect(value.searchParams.get('connectionId')).toBe(id);
  expect(value.searchParams.get('messageUuid')).toBe(id);
  expect(value.searchParams.get('mediaUuids')).toBe(id);
  expect(value.searchParams.get('preview')).toBe('main');
});
it('loads video only on explicit request and removes the element when hidden', async () => {
  expect(find(preview(), 'video')).toBeUndefined();
  await find(preview(), 'button')!.props.onClick!();
  const video = find(preview(), 'video');
  expect(video?.props).toMatchObject({ controls: true, playsInline: true, preload: 'metadata', src: attachmentPreviewPath(scope, id, 'main') });
  await find(preview(), 'button')!.props.onClick!();
  expect(find(preview(), 'video')).toBeUndefined();
  expect(hooks.fetch).not.toHaveBeenCalled();
});
it('renders only a failure notice and explicit retry after media playback fails', async () => {
  await find(preview(), 'button')!.props.onClick!();
  (find(preview(), 'video')!.props as unknown as { onError(): void }).onError();
  expect(find(preview(), 'video')).toBeUndefined();
  expect(JSON.stringify(preview())).toContain('Retry preview');
  expect(JSON.stringify(preview())).toContain('No purchase was made');
});
it('does not invent preview controls for missing variants or unsupported documents', () => {
  expect(find(preview({ ...previewItem, variants: [] }), 'button')).toBeUndefined();
  expect(find(preview({ ...previewItem, mediaType: 'document' }), 'button')).toBeUndefined();
});
