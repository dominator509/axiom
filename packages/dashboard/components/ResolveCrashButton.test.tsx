import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string, values?: Record<string, string | number>) => key === 'incidents.resolutionNotConfirmed' ? `Resolution not confirmed (HTTP ${values?.status}). Refresh the list before retrying.` : key === 'incidents.resolvedNotice' ? 'Marked resolved. This does not replay jobs or fix the underlying cause.' : key === 'incidents.retryResolution' ? 'Resolution not confirmed. Retry to check the same request.' : key === 'incidents.saving' ? 'Saving…' : 'Mark resolved' }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()], useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'resolve-intent', mutationFetch: state.send }));
import ResolveCrashButton from './ResolveCrashButton';
afterEach(() => vi.clearAllMocks());
it('keeps one resolution identity after an uncertain response and requires confirmed status', async () => {
  state.send.mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'report', status: 'resolved' } })));
  const click = ResolveCrashButton({ reportId: 'report' }).props.children[0].props.onClick;
  await click(); expect(state.send).toHaveBeenCalledOnce();
  expect(state.refresh).not.toHaveBeenCalled();
  await click(); expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(state.send).toHaveBeenCalledWith('/api/v1/crash-reports/report/resolve', { method: 'PATCH' }, { idempotencyKey: 'resolve-intent' });
});
