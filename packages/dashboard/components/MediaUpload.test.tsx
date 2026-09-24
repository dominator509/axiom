import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0, fetch: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.i++; if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'same-upload', mutationFetch: hooks.fetch }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
      'media.chooseValid': 'Choose JPEG/PNG up to 20 MB or MP4 up to 64 MB.',
      'media.uploadNotConfirmed': 'Upload not confirmed. Check the same request.',
      'media.storedAsset': 'Stored asset {id}{sanitizedText}. Exact-file SHA-256 {hashState}. {notScanned}',
      'media.sanitizedSuffix': ' with embedded metadata and C2PA removed',
      'media.hashChanged': 'changed',
      'media.hashUnchanged': 'unchanged',
      'media.notScanned': 'This does not prevent perceptual matching. Not yet ToS-scanned or approved.',
      'media.uploadUnconfirmed': 'Upload outcome unconfirmed. Check the same request before uploading again.',
      'media.uploadSection': 'Upload media',
      'media.uploadSource': 'Upload source media',
      'media.file': 'Media file',
      'media.removeMetadata': 'Remove metadata and embedded provenance, including C2PA (optional)',
      'media.uploadLimits': 'JPEG/PNG up to 20 MB; MP4 up to 64 MB.',
      'media.uploading': 'Uploading and processing…',
      'media.checkSameUpload': 'Check same upload',
      'media.upload': 'Upload media',
      }[key] ?? key);
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, name: string) => String(values?.[name] ?? _match));
    },
  }),
}));
import MediaUpload from './MediaUpload';
const uploaded = vi.fn();
function render() { hooks.i = 0; hooks.r = 0; return MediaUpload({ modelId: 'model', onUploaded: uploaded }).props.children; }
function select(sanitize: boolean) {
  render()[1].props.onChange({ target: { files: [new File([new Uint8Array(24)], 'private.png', { type: 'image/png' })] } });
  render()[2].props.children[0].props.onChange({ target: { checked: sanitize } });
}
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); uploaded.mockReset(); });
it.each([true, false])('sends the explicit optional privacy choice %s without leaking the original filename', async sanitize => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: '22222222-2222-4222-8222-222222222222', mimeType: 'image/png', sanitized: sanitize, exactFileHashChanged: sanitize } })));
  select(sanitize); render()[4].props.onClick();
  await vi.waitFor(() => expect(uploaded).toHaveBeenCalledOnce());
  expect(hooks.fetch.mock.calls[0][0]).toBe(`/api/v1/models/model/media-upload?sanitize=${sanitize}`);
  expect(hooks.fetch.mock.calls[0][1].headers).toEqual({ 'content-type': 'image/png' });
  expect(hooks.fetch.mock.calls[0][2]).toMatchObject({ idempotencyKey: 'same-upload', retries: 0 });
});
it('locks selection and reuses the identical file and key after uncertainty', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  select(true); const beforeKey = render()[1].key; render()[4].props.onClick();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[1].props.disabled).toBe(true);
  expect(render()[1].key).toBe(beforeKey);
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
it('reports an unchanged file hash honestly after successful cleaning', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: '22222222-2222-4222-8222-222222222222',
    mimeType: 'image/png', sanitized: true, exactFileHashChanged: false } })));
  select(true); render()[4].props.onClick();
  await vi.waitFor(() => expect(uploaded).toHaveBeenCalledOnce());
  expect(hooks.values[3]).toContain('SHA-256 unchanged');
});
it('resets the native file picker only after a confirmed successful upload', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: {
    id: '22222222-2222-4222-8222-222222222222', mimeType: 'image/png', sanitized: false, exactFileHashChanged: false,
  } })));
  select(false);
  const beforeKey = render()[1].key;
  render()[4].props.onClick();
  await vi.waitFor(() => expect(uploaded).toHaveBeenCalledOnce());
  expect(render()[1].key).not.toBe(beforeKey);
  expect(render()[4].props.disabled).toBe(true);
});
