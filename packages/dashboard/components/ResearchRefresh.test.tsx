import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ effect: undefined as (() => (() => void) | undefined) | undefined, pending: false, refresh: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useTransition: () => [hooks.pending, (work: () => void) => work()],
  useEffect: (effect: () => (() => void) | undefined) => { hooks.effect = effect; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import ResearchRefresh from './ResearchRefresh';
let stop: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); hooks.refresh.mockReset(); hooks.pending = false; vi.stubGlobal('document', { visibilityState: 'visible' }); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
function mount(active: boolean) { ResearchRefresh({ active }); stop = hooks.effect!(); }
it('refreshes active runs without submitting another research job', async () => {
  mount(true); await vi.advanceTimersByTimeAsync(10_000);
  expect(hooks.refresh).toHaveBeenCalledOnce();
  stop?.(); await vi.advanceTimersByTimeAsync(30_000);
  expect(hooks.refresh).toHaveBeenCalledOnce();
});
it('does not poll terminal runs', async () => {
  mount(false); await vi.advanceTimersByTimeAsync(30_000); expect(hooks.refresh).not.toHaveBeenCalled();
});
it('does not poll while a refresh is pending', async () => {
  hooks.pending = true; mount(true); await vi.advanceTimersByTimeAsync(30_000); expect(hooks.refresh).not.toHaveBeenCalled();
});
it('skips background tabs and resumes when visible', async () => {
  vi.stubGlobal('document', { visibilityState: 'hidden' }); mount(true);
  await vi.advanceTimersByTimeAsync(10_000); expect(hooks.refresh).not.toHaveBeenCalled();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  await vi.advanceTimersByTimeAsync(10_000); expect(hooks.refresh).toHaveBeenCalledOnce();
});
