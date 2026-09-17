import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ role: 'chatter', list: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: state.role } }), api: { myShifts: state.list } }));
import Page from './page';
const shift = { id: 'shift', modelId: 'assigned', modelName: 'Assigned talent', queue: 'inbox', startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T08:00:00Z', status: 'active', note: '<private handoff>' };
beforeEach(() => { state.role = 'chatter'; state.list.mockReset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T04:00:00Z')); });
afterEach(() => vi.useRealTimers());
it('renders owned roster, escaped notes and scoped continuation', async () => {
  state.list.mockResolvedValue({ data: [shift], meta: { next_cursor: 'next-id' } });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ cursor: 'position' }) }));
  expect(state.list).toHaveBeenCalledWith('position');
  expect(html).toContain('href="/models/assigned/fans"');
  expect(html).toContain('&lt;private handoff&gt;');
  expect(html).toContain('href="/shifts?cursor=next-id"');
  expect(html).toContain('not a synchronized live DM inbox');
});
it.each([
  { status: 'scheduled' }, { status: 'completed' }, { status: 'cancelled' },
  { startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-02T08:00:00Z' },
  { endsAt: '2030-01-01T04:00:00Z' }, { startsAt: 'invalid' },
])('does not imply active access for %j', async change => {
  state.list.mockResolvedValue({ data: [{ ...shift, ...change }], meta: { next_cursor: null } });
  expect(renderToStaticMarkup(await Page({}))).not.toContain('/models/assigned/fans');
});
it.each(['content_creator', 'model', 'analyst', 'unknown'])('makes no roster request for %s', async role => {
  state.role = role;
  expect(renderToStaticMarkup(await Page({}))).toContain('Shift access unavailable');
  expect(state.list).not.toHaveBeenCalled();
});
it('distinguishes failure from an empty roster', async () => {
  state.list.mockRejectedValue(new Error('private backend error'));
  const html = renderToStaticMarkup(await Page({}));
  expect(html).toContain('could not be loaded');
  expect(html).not.toContain('No assigned shifts'); expect(html).not.toContain('private backend error');
});
