import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
  refresh: vi.fn(),
}));
// Exercise the real handler and mutation client with controlled hooks, not browser automation.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ??= { current: initial },
  useEffect: () => {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'de',
    setLocale: () => undefined,
    t: (key: string) => ({
      'generation.selectPlatform': 'Select at least one destination platform.',
      'generation.promptRequired': 'Enter a media prompt before generating.',
      'generation.sourceImageRequired': 'Select or upload a source image before generating video.',
      'generation.originalModel': 'Return to the original model to reconcile the unresolved generation before starting another.',
      'generation.failed': 'Generation failed',
      'generation.unconfirmed': 'Generation could not be confirmed. Retry the unchanged brief to check the same request.',
      'generation.checkSameRequest': 'Check same generation request',
      'generation.invalidReceipt': 'Invalid generation receipt',
      'generation.sourceImagesUnavailable': 'Could not load source images. Switch away from video and back to retry.',
    }[key] ?? key),
  }),
}));
import GenerateForm from './GenerateForm';

beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function submit(modelId = 'model-a') {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  const element = GenerateForm({ modelId });
  const handler = element.props.children.find((child: { type?: unknown }) => child?.type === 'form').props.onSubmit as (event: FormEvent) => Promise<void>;
  return () => handler({ preventDefault: vi.fn() } as unknown as FormEvent);
}
function response() {
  const media = ['image', 'video'].includes(String(hooks.values[11]));
  return new Response(JSON.stringify({ data: {
    bundle: { id: '11111111-1111-4111-8111-111111111111', modelId: 'model-a' },
    variants: [], tosReport: { verdict: media ? 'pending' : 'review', scores: [] },
    ...(media ? { mediaGeneration: 'queued' } : {}),
  } }));
}
function key(fetch: ReturnType<typeof vi.fn>, index: number) {
  return new Headers(fetch.mock.calls[index][1].headers).get('Idempotency-Key');
}

describe('generation intent', () => {
  it('exposes selected platform state and the reason generation is disabled', () => {
    hooks.stateIndex = 0; hooks.refIndex = 0;
    hooks.values[6] = ['instagram'];
    const selectedHtml = renderToStaticMarkup(GenerateForm({ modelId: 'model-a' }));
    expect(selectedHtml).toContain('aria-pressed="true"');
    expect(selectedHtml).toContain('✓ <!-- -->instagram');

    hooks.values[6] = [];
    hooks.stateIndex = 0; hooks.refIndex = 0;
    const emptyHtml = renderToStaticMarkup(GenerateForm({ modelId: 'model-a' }));
    expect(emptyHtml).toContain('aria-pressed="false"');
    expect(emptyHtml).toContain('role="status"');
    expect(emptyHtml).toContain('Select at least one destination platform.');
    expect(emptyHtml).toContain('aria-describedby="generation-platform-selection-help"');
  });

  it('formats ToS scores in the selected locale', () => {
    hooks.stateIndex = 0;
    hooks.refIndex = 0;
    hooks.values[10] = {
      variants: [],
      tosReport: { verdict: 'review', scores: [{ platform: 'instagram', verdict: 'review', score: 0.2 }] },
    };
    const html = renderToStaticMarkup(GenerateForm({ modelId: 'model-a' }));
    expect(html).toContain('0,2');
  });

  it('opens in video mode with a selected stored source image from the media library', () => {
    hooks.stateIndex = 0; hooks.refIndex = 0;
    GenerateForm({ modelId: 'model-a', initialSourceAssetId: '11111111-1111-4111-8111-111111111111' });
    expect(hooks.values[11]).toBe('video');
    expect(hooks.values[13]).toBe('11111111-1111-4111-8111-111111111111');
  });
  it.each(['', '   '])('omits cleared defaulted fields (%j) while preserving the media prompt', async blank => {
    submit();
    for (let index = 0; index < 5; index++) hooks.values[index] = blank;
    hooks.values[11] = 'image'; hooks.values[12] = 'A ceramic vase';
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    await submit()();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    for (const field of ['style', 'outfit', 'location', 'mood', 'lighting'])
      expect(body).not.toHaveProperty(field);
    expect(body.media.prompt).toBe('A ceramic vase');
    expect(body.media.aspectRatio).toBe('3:4');
  });

  it('preserves nonblank defaulted fields', async () => {
    submit(); hooks.values[1] = ''; hooks.values[2] = ' sunlit table ';
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      style: 'studio', location: ' sunlit table ', mood: 'energetic', lighting: 'soft studio',
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('outfit');
  });

  it('accepts the API variant and scored text-report shape', async () => {
    const payload = await response().json();
    payload.data.variants = [{ prompt: 'A studio portrait', caption: 'Studio light',
      styleLabel: 'Close-up', hashtags: ['studio'] }];
    payload.data.tosReport.scores = [{ platform: 'instagram', verdict: 'review', score: 0.2 }];
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(hooks.refresh).toHaveBeenCalledOnce();
    expect(hooks.values[10]).toEqual(payload.data);
    expect(hooks.values[9]).toBe(null);
  });

  it.each(['missing-queue', 'false-pass'])('rejects a media receipt with %s evidence', async issue => {
    submit(); hooks.values[11] = 'image'; hooks.values[12] = 'A vase';
    const payload = await response().json();
    if (issue === 'missing-queue') delete payload.data.mediaGeneration;
    else payload.data.tosReport.verdict = 'pass';
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(hooks.refresh).not.toHaveBeenCalled();
    expect(hooks.values[9]).toEqual(expect.stringContaining('could not be confirmed'));
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 1)).toBe(key(fetch, 0));
  });

  it.each([
    {}, { data: null },
    { data: { variants: [], tosReport: { verdict: 'pass', scores: [] } } },
    { data: { bundle: { id: '11111111-1111-4111-8111-111111111111', modelId: 'other-model' }, variants: [], tosReport: { verdict: 'pass', scores: [] } } },
    { data: { bundle: { id: '11111111-1111-4111-8111-111111111111', modelId: 'model-a' }, variants: [null], tosReport: { verdict: 'pass', scores: [] } } },
  ])('retains the request when successful HTTP does not provide a valid receipt: %j', async payload => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(hooks.refresh).not.toHaveBeenCalled();
    expect(hooks.values[10]).toBe(null);
    expect(hooks.values[9]).toEqual(expect.stringContaining('could not be confirmed'));
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 1)).toBe(key(fetch, 0));
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });
  it('includes the optional sanitizer selection in the queued media intent', async () => {
    submit(); hooks.values[11] = 'image'; hooks.values[12] = 'Landscape'; hooks.values[17] = true;
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(JSON.parse(fetch.mock.calls[0][1].body).media.sanitizeMetadata).toBe(true);
  });
  it.each(['image', 'video'])('submits the %s media contract with the same retry key', async kind => {
    submit(); // Initialize the controlled hook state.
    hooks.values[11] = kind;
    hooks.values[12] = 'A landscape';
    hooks.values[13] = '11111111-1111-4111-8111-111111111111';
    hooks.values[14] = 10;
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    fetch.mockResolvedValue(response());
    await submit()();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.media).toEqual(kind === 'image'
      ? { kind, prompt: 'A landscape', aspectRatio: '3:4' }
      : { kind, prompt: 'A landscape', sourceAssetId: hooks.values[13], duration: 10 });
    expect(body).not.toHaveProperty('userId');
    expect(key(fetch, 2)).toBe(key(fetch, 0));
  });
  it('does not submit video without a selected source image', async () => {
    submit();
    hooks.values[11] = 'video';
    hooks.values[12] = 'Animate this';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(fetch).not.toHaveBeenCalled();
    expect(hooks.values[9]).toBe('Select or upload a source image before generating video.');
  });

  it('explains a whitespace-only media prompt instead of silently ignoring submit', async () => {
    submit(); hooks.values[11] = 'image'; hooks.values[12] = '   ';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(fetch).not.toHaveBeenCalled();
    expect(hooks.values[9]).toBe('Enter a media prompt before generating.');
    expect(hooks.values[8]).toBe(false);
  });
  it('reuses the same model and payload key after lost responses', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hooks.values[9]).toEqual(expect.stringContaining('could not be confirmed'));
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 0)).toBeTruthy();
    expect(key(fetch, 1)).toBe(key(fetch, 0));
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it('suppresses overlapping submits and releases busy state', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const handler = submit();
    const pending = handler();
    await handler();
    expect(fetch).toHaveBeenCalledOnce();
    expect(hooks.values[8]).toBe(true);
    finish(response());
    await pending;
    expect(hooks.values[8]).toBe(false);
  });

  it('reconciles the original intent even if field state changes after a lost response', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    hooks.values[0] = 'outdoor';
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 2)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[0][1].body);
  });

  it('never moves an unresolved intent to another model', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    await submit('model-b')();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hooks.values[9]).toEqual(expect.stringContaining('original model'));
  });

  it.each([401, 403, 404, 408, 409, 429, 500])('retains exact intent on unresolved HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Check this request' }), { status }));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    expect(hooks.values[9]).toBe('Check this request');
    hooks.values[0] = 'outdoor';
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 1)).toBe(key(fetch, 0));
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });

  it('locks inputs after uncertainty but leaves reconciliation outside the disabled fieldset', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    hooks.stateIndex = 0; hooks.refIndex = 0;
    const form = GenerateForm({ modelId: 'model-a' }).props.children.find((child: { type?: unknown }) => child?.type === 'form');
    expect(form.props.children.find((child: { type?: unknown }) => child?.type === 'fieldset').props.disabled).toBe(true);
    const action = form.props.children.find((child: { type?: unknown }) => child?.type === 'div').props.children;
    expect(action.props.type).toBe('submit');
    expect(action.props.disabled).toBe(false);
    expect(action.props.children).toBe('Check same generation request');
  });

  it('allows corrected input with a new key after a definite validation rejection', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Invalid input' }), { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    await submit()();
    hooks.values[0] = 'outdoor';
    fetch.mockResolvedValue(response());
    await submit()();
    expect(key(fetch, 1)).not.toBe(key(fetch, 0));
    expect(JSON.parse(fetch.mock.calls[1][1].body).style).toBe('outdoor');
  });
});
