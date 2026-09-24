import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
const state = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn(), update: vi.fn(), hook: 0 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (value: unknown) => [state.hook++ === 0 ? true : value, state.update], useRef: (value: unknown) => ({ current: value }) }));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'recovery-intent', mutationFetch: state.send }));
import RecoverDigestSchedule from './RecoverDigestSchedule';
afterEach(() => { vi.clearAllMocks(); state.hook = 0; });
const buttonOf = (tree: ReactElement<{ children: Array<ReactElement<{ onClick: () => void }> | null> }>) => tree.props.children.find(child => child?.type === 'button')!;
const scheduleId = '22222222-2222-4222-8222-222222222222';
it('retains one replacement identity and idempotency key across lost responses', async () => {
  state.send.mockRejectedValueOnce(new Error('lost')).mockImplementationOnce(async (_url, request) => new Response(JSON.stringify({ data: { weeklyDigestScheduleId: JSON.parse(request.body).weeklyDigestRecovery.replacementScheduleId } })));
  const tree = RecoverDigestSchedule({ scheduleId })!;
  const button = buttonOf(tree);
  button.props.onClick();
  await vi.waitFor(() => expect(state.update).toHaveBeenCalledWith('Recovery not confirmed. Retry the same recovery; do not start a new one.'));
  button.props.onClick();
  await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  expect(JSON.parse(state.send.mock.calls[0][1].body).weeklyDigestRecovery.expectedScheduleId).toBe(scheduleId);
});
it('does not confirm a stale or malformed recovery receipt', async () => {
  state.send.mockResolvedValue(new Response(JSON.stringify({ data: { weeklyDigestScheduleId: scheduleId } })));
  const tree = RecoverDigestSchedule({ scheduleId })!;
  buttonOf(tree).props.onClick();
  await vi.waitFor(() => expect(state.update).toHaveBeenCalledWith('Recovery not confirmed. Retry the same recovery; do not start a new one.'));
  expect(state.refresh).not.toHaveBeenCalled();
});
