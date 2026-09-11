import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], i: 0, r: 0,
  fetch: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.r++] ??= { current: initial },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push, refresh: hooks.refresh }) }));
vi.mock('@/lib/request', () => ({ fetchWithTimeout: hooks.fetch }));
import LoginForm from './LoginForm';
beforeEach(() => { hooks.values = []; hooks.refs = []; vi.clearAllMocks(); });
function render(allowSignup = false) { hooks.i = 0; hooks.r = 0; return LoginForm({ allowSignup }); }
function fill() { hooks.values[0] = 'operator@example.invalid'; hooks.values[1] = 'synthetic-test-password'; }
it('hides signup by default and uses the ordinary signin endpoint', async () => {
  const form = render(); expect(form.props.children[4]).toBe(false);
  fill(); hooks.fetch.mockResolvedValue(new Response('{}'));
  await render().props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch.mock.calls[0][0]).toBe('/api/auth/sign-in/email');
  expect(hooks.values[1]).toBe('');
});
it('opt-in signup sends no workspace or role and clears the password', async () => {
  render(true).props.children[4].props.children[0].props.onClick();
  fill(); hooks.fetch.mockResolvedValue(new Response('{}'));
  await render(true).props.onSubmit({ preventDefault() {} });
  const [path, init] = hooks.fetch.mock.calls[0];
  expect(path).toBe('/api/auth/sign-up/email');
  expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['email', 'name', 'password']);
  expect(init.credentials).toBe('same-origin'); expect(init.redirect).toBe('error');
  expect(hooks.values[1]).toBe(''); expect(hooks.push).toHaveBeenCalledWith('/');
});
it('does not retry a failed signup or navigate on failure', async () => {
  render(true).props.children[4].props.children[0].props.onClick(); fill();
  hooks.fetch.mockRejectedValue(new Error('offline'));
  await render(true).props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch).toHaveBeenCalledOnce(); expect(hooks.push).not.toHaveBeenCalled();
  expect(hooks.values[1]).toBe('');
});
