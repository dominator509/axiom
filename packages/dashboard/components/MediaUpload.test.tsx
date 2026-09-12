import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0, fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.i++; if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'same-upload', mutationFetch: hooks.fetch }));
import MediaUpload from './MediaUpload';
const uploaded = vi.fn();
function render() { hooks.i = 0; hooks.r = 0; return MediaUpload({ modelId: 'model', onUploaded: uploaded }).props.children; }
function select(sanitize: boolean) {
  render()[1].props.onChange({ target: { files: [new File([new Uint8Array(24)], 'private.png', { type: 'image/png' })] } });
  render()[2].props.children[0].props.onChange({ target: { checked: sanitize } });
}
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); uploaded.mockReset(); });
it.each([true, false])('sends the explicit optional privacy choice %s without leaking the original filename', async sanitize => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: '22222222-2222-4222-8222-222222222222', mimeType: 'image/png', sanitized: sanitize } })));
  select(sanitize); render()[4].props.onClick();
  await vi.waitFor(() => expect(uploaded).toHaveBeenCalledOnce());
  expect(hooks.fetch.mock.calls[0][0]).toBe(`/api/v1/models/model/media-upload?sanitize=${sanitize}`);
  expect(hooks.fetch.mock.calls[0][1].headers).toEqual({ 'content-type': 'image/png' });
  expect(hooks.fetch.mock.calls[0][2]).toMatchObject({ idempotencyKey: 'same-upload', retries: 0 });
});
it('locks selection and reuses the identical file and key after uncertainty', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  select(true); render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[1].props.disabled).toBe(true);
  render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
  expect(uploaded).not.toHaveBeenCalled();
});
it('unlocks editing after the API confirms that no asset was stored', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'ASSET_UPLOAD_NOT_STORED', detail: 'Invalid media' }), { status: 422 }));
  select(true); render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[1].props.disabled).toBe(false);
  expect(uploaded).not.toHaveBeenCalled();
});
