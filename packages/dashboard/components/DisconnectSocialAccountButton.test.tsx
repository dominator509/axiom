import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'disconnect-intent', mutationFetch: state.send }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ locale: 'en', t: (key: string, values?: Record<string, string | number>) => ({
  'connection.disconnectConfirmNamed': `Disconnect ${String(values?.name ?? '')}? Provider revocation must succeed before the local account is removed.`,
  'connection.disconnectRequestRejected': 'The disconnect request was rejected. Check provider access and try again.',
  'connection.disconnectSuccess': 'Provider revoked and local connection removed.',
  'connection.disconnectRetry': 'Disconnect was not confirmed. Retry the same revocation request.',
  'connection.disconnecting': 'Disconnecting…',
  'action.disconnect': 'Disconnect',
}[key] ?? key) }) }));
import DisconnectSocialAccountButton from './DisconnectSocialAccountButton';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('requires confirmation and validates the provider-revocation response', async () => {
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('window', { confirm });
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'account' } })));
  const click = DisconnectSocialAccountButton({ accountId: 'account', displayName: 'x (Luna)' }).props.children[0].props.onClick;
  await click(); expect(state.send).not.toHaveBeenCalled();
  click(); await new Promise(resolve => setTimeout(resolve, 0)); await Promise.resolve();
  expect(state.send).toHaveBeenCalledWith('/api/v1/social-accounts/account', { method: 'DELETE' }, { idempotencyKey: 'disconnect-intent' });
  expect(state.refresh).toHaveBeenCalledOnce();
});
