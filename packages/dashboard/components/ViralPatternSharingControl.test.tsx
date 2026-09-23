import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'sharing-intent', mutationFetch: state.send }));
vi.mock('@/lib/response', () => ({
  readDashboardError: vi.fn(async () => null),
  readDashboardJson: async (response: Response) => response.json(),
}));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import ViralPatternSharingControl from './ViralPatternSharingControl';

afterEach(() => vi.clearAllMocks());

it('saves a confirmed sharing preference with an idempotent owner mutation', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { enabled: true } })));
  const form = ViralPatternSharingControl({ modelId: 'model-1', initialEnabled: true, canManage: true });
  if (!form) throw new Error('manager control was unexpectedly hidden');
  await form.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.send).toHaveBeenCalledWith(
    '/api/v1/models/model-1/viral/pattern-sharing',
    expect.objectContaining({ method: 'PATCH', body: '{"enabled":true}' }),
    { idempotencyKey: 'sharing-intent', retries: 0 },
  );
  expect(state.refresh).toHaveBeenCalledOnce();
});

it('fails closed when consent state did not load and hides controls from non-managers', () => {
  const unavailable = ViralPatternSharingControl({ modelId: 'model-1', initialEnabled: null, canManage: true });
  if (!unavailable) throw new Error('manager status should be visible');
  expect(unavailable.props.children).toContain('dashboard.performance.sharingLoadFailed');
  expect(ViralPatternSharingControl({ modelId: 'model-1', initialEnabled: true, canManage: false })).toBeNull();
});
