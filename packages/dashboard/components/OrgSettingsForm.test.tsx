import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'settings-intent', mutationFetch: state.send }));
import OrgSettingsForm from './OrgSettingsForm';
afterEach(() => vi.clearAllMocks());
it('sends only the two existing workspace settings and validates the saved response', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { viralSharing: true, publishingEnabled: false } })));
  const form = OrgSettingsForm({ initial: { viralSharing: true, publishingEnabled: false } });
  await form.props.onSubmit({ preventDefault() {} });
  expect(state.send).toHaveBeenCalledWith('/api/v1/org-settings', expect.objectContaining({ method: 'PATCH', body: '{"viralSharing":true,"publishingEnabled":false}' }), { idempotencyKey: 'settings-intent' });
});
