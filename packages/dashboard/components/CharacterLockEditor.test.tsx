import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0,
  fetch: vi.fn(), key: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: hooks.key, mutationFetch: hooks.fetch }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
        'characterLock.editorAria': 'Character lock editor',
        'characterLock.label': 'Character / persona lock prompt',
        'characterLock.description': 'Revision {version}. Describe consistent appearance and persona here. New image/video jobs snapshot this text; scene instructions remain separate. Clear the field and save to disable it for new jobs.',
        'characterLock.saving': 'Saving…',
        'characterLock.checkSameSave': 'Check same save request',
        'characterLock.save': 'Save character lock',
        'characterLock.reloadProfile': 'Reload current profile',
        'characterLock.saved': 'Character lock saved. Existing generations and retries retain their previous snapshot.',
        'characterLock.conflict': 'Save was not confirmed. Check the same request before editing again.',
        'characterLock.unconfirmed': 'Save outcome unconfirmed. Check the same save request; the editor stays locked to prevent overwriting another revision.',
      } as Record<string, string>)[key] ?? key;
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, name: string) => String(values?.[name] ?? `{${name}}`));
    },
  }),
}));
import CharacterLockEditor from './CharacterLockEditor';
function render() {
  hooks.i = 0; hooks.r = 0;
  return CharacterLockEditor({ modelId: 'model', initialPrompt: 'Original identity', initialVersion: 4 }).props.children;
}
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.fetch.mockReset(); hooks.refresh.mockReset();
  hooks.key.mockReset().mockReturnValue('save-intent'); });
it('saves an edited prompt with the viewed revision without dispatching on render', async () => {
  render(); expect(hooks.fetch).not.toHaveBeenCalled();
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'model', characterLockPrompt: 'Updated identity', characterLockVersion: 5 } })));
  render()[1].props.onChange({ target: { value: 'Updated identity' } }); render()[3].props.onClick();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(JSON.parse(hooks.fetch.mock.calls[0][1].body)).toEqual({ characterLockPrompt: 'Updated identity', characterLockVersion: 4 });
  expect(hooks.values[1]).toBe(5);
  expect(render()[1].props.disabled).toBe(false);
  expect(hooks.values[4]).toBe('Character lock saved. Existing generations and retries retain their previous snapshot.');
});
it('locks edits and reuses the exact intent after a lost response', async () => {
  hooks.fetch.mockRejectedValue(new Error('lost response'));
  render()[3].props.onClick(); render()[3].props.onClick();
  expect(hooks.fetch).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[1].props.disabled).toBe(true);
  render()[3].props.onClick();
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  expect(hooks.fetch.mock.calls[1]).toEqual(hooks.fetch.mock.calls[0]);
  expect(hooks.key).toHaveBeenCalledOnce();
});
it('requires a reload on revision conflict rather than overwriting', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'CHARACTER_LOCK_CONFLICT', detail: 'Reload' }), { status: 409 }));
  render()[3].props.onClick(); await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(render()[3].props.disabled).toBe(true);
  render()[3].props.onClick(); expect(hooks.fetch).toHaveBeenCalledOnce();
  render()[4].props.onClick(); expect(hooks.refresh).toHaveBeenCalledOnce();
  expect(render()[4].props.children).toBe('Reload current profile');
});
it('does not accept a response for a different profile', async () => {
  hooks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'other', characterLockPrompt: 'Original identity', characterLockVersion: 5 } })));
  render()[3].props.onClick(); await vi.waitFor(() => expect(hooks.values[2]).toBe(false));
  expect(hooks.values[1]).toBe(4);
  expect(render()[1].props.disabled).toBe(true);
});
it('renders the localized label, aria label and interpolated revision', () => {
  const section = CharacterLockEditor({ modelId: 'model', initialPrompt: 'Original identity', initialVersion: 4 });
  const children = section.props.children as unknown as Array<{ props: Record<string, unknown> }>;
  expect(section.props['aria-label']).toBe('Character lock editor');
  expect(children[0].props.children).toBe('Character / persona lock prompt');
  expect(String(children[2].props.children)).toContain('Revision 4.');
  expect(children[3].props.children).toBe('Save character lock');
});
