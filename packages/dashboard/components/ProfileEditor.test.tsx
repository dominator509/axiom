import { afterEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()], useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'profile-intent', mutationFetch: state.send }));
import ProfileEditor, { profilePayload } from './ProfileEditor';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function fields() {
  const form = new FormData(); form.set('displayName', ' Creator '); form.set('handle', ' creator '); form.set('bio', ''); return form;
}
it('validates required fields, permits clearing bio, and never edits the character lock or account state', () => {
  const form = fields(); form.set('characterLockPrompt', 'ignored'); form.set('isActive', 'false');
  expect(profilePayload(form)).toEqual({ displayName: 'Creator', handle: 'creator', bio: '' });
  form.set('displayName', ' '); expect(() => profilePayload(form)).toThrow('creator name');
  form.set('displayName', 'Creator'); form.set('bio', 'x'.repeat(501)); expect(() => profilePayload(form)).toThrow('500');
});
it('retains original changes and key after an uncertain save and validates the returned profile', async () => {
  const form = fields();
  vi.stubGlobal('FormData', class { get(key: string) { return form.get(key); } });
  state.send.mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify({ data: {
    id: 'model', displayName: 'Creator', handle: 'creator', bio: '',
  } })));
  const submit = ProfileEditor({ model: { id: 'model', displayName: 'Old', handle: 'old', bio: 'Old' } }).props.children[1].props.onSubmit;
  const event = { preventDefault() {}, currentTarget: {} } as unknown as FormEvent<HTMLFormElement>;
  await submit(event); expect(state.refresh).not.toHaveBeenCalled();
  form.set('displayName', 'Changed after timeout');
  await submit(event);
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(state.send).toHaveBeenCalledWith('/api/v1/models/model', expect.objectContaining({ method: 'PATCH', body: '{"displayName":"Creator","handle":"creator","bio":""}' }), { idempotencyKey: 'profile-intent' });
  expect(state.refresh).toHaveBeenCalledOnce();
});
