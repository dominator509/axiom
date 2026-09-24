import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'viral-intent', mutationFetch: state.send }));

import GenerateViralInsightButton from './GenerateViralInsightButton';

afterEach(() => vi.clearAllMocks());

it('requires a confirmed model-scoped job receipt and does not retry transport automatically', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-viral-12345678', windowKey: '2026-08-03' })));
  const click = GenerateViralInsightButton({ modelId: 'model-1' }).props.children[0].props.onClick;
  click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.send).toHaveBeenCalledWith(
    '/api/v1/models/model-1/viral/insight',
    { method: 'POST' },
    { idempotencyKey: 'viral-intent', retries: 0 },
  );
  expect(state.refresh).toHaveBeenCalledOnce();
});
