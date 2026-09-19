import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'digest-intent', mutationFetch: state.send }));
import GenerateDigestButton from './GenerateDigestButton';
afterEach(() => vi.clearAllMocks());
it('requires a confirmed job receipt and disables automatic transport retry', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-12345678' })));
  const click = GenerateDigestButton().props.children[0].props.onClick;
  click(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.send).toHaveBeenCalledWith('/api/v1/digests/generate', { method: 'POST' }, { idempotencyKey: 'digest-intent', retries: 0 });
  expect(state.refresh).toHaveBeenCalledOnce();
});
