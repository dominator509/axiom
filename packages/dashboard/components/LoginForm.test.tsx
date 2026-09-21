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
  useContext: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'auth.accountCreationFailed': 'Account creation failed',
        'auth.signInFailed': 'Sign-in failed',
        'auth.accountCreationAccepted': 'Account creation was accepted',
        'auth.signInAccepted': 'Sign-in was accepted',
        'auth.sessionNotConfirmed': '{action}, but your browser session could not be confirmed. Check that cookies are allowed for this site, then reload. {advice}',
        'auth.sessionSignupAdvice': 'Do not create another account; use Sign in if needed.',
        'auth.sessionSigninAdvice': 'If this continues, contact your administrator.',
        'auth.networkError': 'Network error — is the API reachable?',
        'affiliate.claimFailed': 'Affiliate attribution could not be recorded. Keep this page open and retry sign-in.',
        'auth.email': 'Email', 'auth.password': 'Password',
        'auth.emailPlaceholder': 'operator@axiom.local', 'auth.wait': 'Please wait…',
        'auth.createAccount': 'Create FanThynks account', 'auth.signIn': 'Sign in',
        'auth.useExisting': 'Use existing FanThynks account',
        'auth.firstTime': 'First time? Create FanThynks account',
        'auth.passwordHint': 'Choose a new FanThynks password, not your Grok password. Account creation does not grant workspace access; your administrator must assign it before you can connect Grok.',
      };
      return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
    },
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push, refresh: hooks.refresh }) }));
vi.mock('@/lib/request', () => ({ fetchWithTimeout: hooks.fetch }));
import LoginForm from './LoginForm';
beforeEach(() => { hooks.values = []; hooks.refs = []; vi.resetAllMocks(); });
function render(allowSignup = false, affiliateRef?: string) { hooks.i = 0; hooks.r = 0; return LoginForm({ allowSignup, affiliateRef }); }
function fill() { hooks.values[0] = 'operator@example.invalid'; hooks.values[1] = 'synthetic-test-password'; }
function successfulSession() {
  hooks.fetch.mockResolvedValueOnce(Response.json({ user: { id: 'test-operator' } }))
    .mockResolvedValueOnce(Response.json({ user: { id: 'test-operator' } }));
}
it('hides signup by default and uses the ordinary signin endpoint', async () => {
  const form = render(); expect(form.props.children[4]).toBe(false);
  fill(); successfulSession();
  await render().props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch.mock.calls[0][0]).toBe('/api/auth/sign-in/email');
  expect(hooks.values[1]).toBe('');
});
it('opt-in signup sends no workspace or role and clears the password', async () => {
  render(true).props.children[4].props.children[0].props.onClick();
  fill(); successfulSession();
  await render(true).props.onSubmit({ preventDefault() {} });
  const [path, init] = hooks.fetch.mock.calls[0];
  expect(path).toBe('/api/auth/sign-up/email');
  expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['email', 'name', 'password']);
  expect(init.credentials).toBe('same-origin'); expect(init.redirect).toBe('error');
  expect(hooks.values[1]).toBe(''); expect(hooks.push).toHaveBeenCalledWith('/');
});
it('confirms a usable same-origin session before navigating', async () => {
  fill(); successfulSession();
  await render().props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch).toHaveBeenCalledTimes(2);
  expect(hooks.fetch.mock.calls[1]).toEqual(['/api/auth/get-session', {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  }]);
  expect(hooks.push).toHaveBeenCalledWith('/');
});
it('claims a validated referral after session confirmation and before navigation', async () => {
  fill(); successfulSession();
  hooks.fetch.mockResolvedValueOnce(Response.json({ data: { claimed: true }, duplicate: false }, { status: 201 }));
  await render(false, 'ref-token').props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch.mock.calls[2]).toEqual(['/api/affiliate/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    credentials: 'same-origin', redirect: 'error',
    body: JSON.stringify({ referralToken: 'ref-token' }),
  }]);
  expect(hooks.push).toHaveBeenCalledWith('/');
});
it('does not leave signup active when the referral claim fails after account creation', async () => {
  render(true).props.children[4].props.children[0].props.onClick();
  fill(); successfulSession();
  hooks.fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
  await render(true, 'ref-token').props.onSubmit({ preventDefault() {} });
  expect(hooks.push).not.toHaveBeenCalled();
  expect(hooks.values[2]).toBe('Affiliate attribution could not be recorded. Keep this page open and retry sign-in.');
  expect(hooks.values[4]).toBe(false);
});
it.each([null, {}, { user: {} }, { user: { id: '' } }, { user: { id: 1 } }, { user: { id: 'another-operator' } }])(
  'does not navigate when sign-in succeeds but session is unusable: %j', async session => {
    fill(); hooks.fetch.mockResolvedValueOnce(Response.json({ user: { id: 'test-operator' } }))
      .mockResolvedValueOnce(Response.json(session));
    await render().props.onSubmit({ preventDefault() {} });
    expect(hooks.push).not.toHaveBeenCalled();
    expect(hooks.values[2]).toContain('session could not be confirmed');
    expect(hooks.values[1]).toBe('');
    expect(hooks.fetch).toHaveBeenCalledTimes(2);
  },
);
it('does not repeat account creation when session confirmation fails', async () => {
  render(true).props.children[4].props.children[0].props.onClick(); fill();
  hooks.fetch.mockResolvedValueOnce(Response.json({ user: { id: 'test-operator' } })).mockRejectedValueOnce(new Error('offline'));
  await render(true).props.onSubmit({ preventDefault() {} });
  expect(hooks.values[2]).toContain('Account creation was accepted');
  expect(hooks.values[2]).toContain('Do not create another account');
  expect(hooks.fetch).toHaveBeenCalledTimes(2);
  expect(hooks.push).not.toHaveBeenCalled();
});
it.each([new Response('not-json'), new Response('{}', { status: 503 })])(
  'does not navigate on an invalid session response', async response => {
    fill(); hooks.fetch.mockResolvedValueOnce(Response.json({ user: { id: 'test-operator' } }))
      .mockResolvedValueOnce(response);
    await render().props.onSubmit({ preventDefault() {} });
    expect(hooks.push).not.toHaveBeenCalled();
    expect(hooks.values[2]).toContain('session could not be confirmed');
  },
);
it('blocks a double submit while session confirmation is pending', async () => {
  fill(); let complete!: (response: Response) => void;
  hooks.fetch.mockResolvedValueOnce(Response.json({ user: { id: 'test-operator' } }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  const pending = render().props.onSubmit({ preventDefault() {} });
  await vi.waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(2));
  await render().props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch).toHaveBeenCalledTimes(2);
  expect(hooks.push).not.toHaveBeenCalled();
  complete(Response.json({ user: { id: 'test-operator' } }));
  await pending;
  expect(hooks.push).toHaveBeenCalledOnce();
});
it('does not retry a failed signup or navigate on failure', async () => {
  render(true).props.children[4].props.children[0].props.onClick(); fill();
  hooks.fetch.mockRejectedValue(new Error('offline'));
  await render(true).props.onSubmit({ preventDefault() {} });
  expect(hooks.fetch).toHaveBeenCalledOnce(); expect(hooks.push).not.toHaveBeenCalled();
  expect(hooks.values[1]).toBe('');
});
