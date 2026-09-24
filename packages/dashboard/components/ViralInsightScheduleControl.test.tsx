import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'schedule-intent', mutationFetch: state.send }));
vi.mock('@/lib/response', () => ({
  readDashboardError: vi.fn(async () => null),
  readDashboardJson: async (response: Response) => response.json(),
}));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import ViralInsightScheduleControl from './ViralInsightScheduleControl';

afterEach(() => vi.clearAllMocks());

it('saves the confirmed recurring schedule using an idempotent owner mutation', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { enabled: true, scheduleId: 'schedule-1' } })));
  const form = ViralInsightScheduleControl({ modelId: 'model-1', initialEnabled: true, canManage: true });
  if (!form) throw new Error('manager control was unexpectedly hidden');
  await form.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.send).toHaveBeenCalledWith(
    '/api/v1/models/model-1/viral/insight-schedule',
    expect.objectContaining({ method: 'PATCH', body: '{"enabled":true}' }),
    { idempotencyKey: 'schedule-intent', retries: 0 },
  );
  expect(state.refresh).toHaveBeenCalledOnce();
});

it('fails closed when schedule state did not load and hides controls from non-managers', () => {
  const unavailable = ViralInsightScheduleControl({ modelId: 'model-1', initialEnabled: null, canManage: true });
  if (!unavailable) throw new Error('manager status should be visible');
  expect(unavailable.props.children)
    .toContain('dashboard.viralInsight.scheduleLoadError');
  expect(ViralInsightScheduleControl({ modelId: 'model-1', initialEnabled: true, canManage: false })).toBeNull();
});
