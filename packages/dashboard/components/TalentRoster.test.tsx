import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelProfile } from '@/lib/api';

// Controlled hooks exercise the component's real cursor-transition state handling,
// not a browser. `useState` keeps its value across renders (same process), so a
// second render with a different `cursor` reproduces a client navigation where the
// component instance is reused rather than remounted.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  stateIndex: 0,
  listeners: {} as Record<string, (event: Event) => void>,
}));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { effect(); },
  useMemo: (factory: () => unknown) => factory(),
  // useState keeps its slot across renders in this process, so a second render with a
  // different cursor reproduces client navigation reusing the component instance.
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function'
        ? (value as (current: unknown) => unknown)(hooks.values[index])
        : value;
    }];
  },
}));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
}));

import TalentRoster from './TalentRoster';

const profile = (id: string): ModelProfile => ({
  id, displayName: id, handle: id, bio: null, isActive: true,
} as unknown as ModelProfile);

beforeEach(() => {
  hooks.values = [];
  hooks.stateIndex = 0;
  hooks.listeners = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, handler: (event: Event) => void) => { hooks.listeners[type] = handler; },
    removeEventListener: (type: string) => { delete hooks.listeners[type]; },
    dispatchEvent: () => true,
  });
});
afterEach(() => vi.unstubAllGlobals());

function render(models: ModelProfile[], props: { totalCount: number | null; nextCursor: string | null; cursor?: string; error?: boolean }) {
  // React re-runs the component when state is set during render. Our plain-function
  // harness must do the same: re-render until the state slots stop changing.
  let markup = '';
  for (let pass = 0; pass < 4; pass++) {
    hooks.stateIndex = 0;
    const before = JSON.stringify(hooks.values);
    markup = renderToStaticMarkup(TalentRoster({
      models, totalCount: props.totalCount, nextCursor: props.nextCursor,
      cursor: props.cursor, error: props.error ?? false,
    }));
    if (JSON.stringify(hooks.values) === before) break;
  }
  return markup;
}

// A create on page 1 publishes this receipt; the roster holds it optimistically.
function createdReceipt(id: string) {
  return new CustomEvent('axiom:talent-profile-created', { detail: profile(id) });
}

describe('talent roster cursor transition', () => {
  it('scopes an optimistic page-1 row to page 1 and does not leak it into page 2', () => {
    // Page 1: one server row, and a create arrives optimistically.
    render([profile('p1-a')], { totalCount: 1, nextCursor: 'c1' });
    hooks.listeners['axiom:talent-profile-created'](createdReceipt('created-on-p1'));
    const page1 = render([profile('p1-a')], { totalCount: 1, nextCursor: 'c1' });
    expect(page1).toContain('created-on-p1');
    expect(page1).toContain('2'); // total reflects the optimistic row on its own page

    // Page 2: a different cursor, different rows. The page-1 optimistic row must be gone.
    const page2 = render([profile('p2-a'), profile('p2-b')], { totalCount: 1, nextCursor: null, cursor: 'c1' });
    expect(page2).not.toContain('created-on-p1');
    expect(page2).toContain('p2-a');
    expect(page2).toContain('p2-b');
  });

  it('reports the shown count for the requested page only', () => {
    render([profile('p1-a')], { totalCount: 1, nextCursor: 'c1' });
    hooks.listeners['axiom:talent-profile-created'](createdReceipt('created-on-p1'));
    const page2 = render([profile('p2-a'), profile('p2-b')], { totalCount: 1, nextCursor: null, cursor: 'c1' });
    // "profilesShown" small text should read 2 (page-2 rows), not 3.
    expect(page2).toContain('home.profilesShown');
    expect(page2).not.toMatch(/>3</);
  });
});
