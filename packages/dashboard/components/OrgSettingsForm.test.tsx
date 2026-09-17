import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn(), update: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (value: unknown) => [value, state.update], useRef: (value: unknown) => ({ current: value }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'settings-intent', mutationFetch: state.send }));
import OrgSettingsForm from './OrgSettingsForm';
afterEach(() => vi.clearAllMocks());
it('saves opt-in weekly scheduling with the workspace settings', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { viralSharing: true, publishingEnabled: false, weeklyDigestEnabled: true } })));
  const form = OrgSettingsForm({ initial: { viralSharing: true, publishingEnabled: false, weeklyDigestEnabled: true } });
  await form.props.onSubmit({ preventDefault() {} });
  expect(state.send).toHaveBeenCalledWith('/api/v1/org-settings', expect.objectContaining({ method: 'PATCH', body: '{"viralSharing":true,"publishingEnabled":false,"weeklyDigestEnabled":true}' }), { idempotencyKey: 'settings-intent' });
  await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
});
it('does not confirm a save when the server omits the schedule receipt', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { viralSharing: false, publishingEnabled: false } })));
  const form = OrgSettingsForm({ initial: { viralSharing: false, publishingEnabled: false, weeklyDigestEnabled: true } });
  form.props.onSubmit({ preventDefault() {} });
  await vi.waitFor(() => expect(state.update).toHaveBeenCalledWith('Settings save not confirmed. Retry without changing the choices.'));
  expect(state.refresh).not.toHaveBeenCalled();
});
