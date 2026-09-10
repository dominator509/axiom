import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RootLayout from './layout';

afterEach(() => vi.unstubAllGlobals());

async function render(user: Record<string, unknown> | null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(user ? { user } : null))));
  return renderToStaticMarkup(await RootLayout({ children: <p>Workspace contents</p> }));
}

describe('dashboard session presentation', () => {
  it('retains the anonymous authentication shell', async () => {
    const html = await render(null);
    expect(html).toContain('Workspace contents');
    expect(html).not.toContain('Primary navigation');
  });

  it.each([null, undefined, ''])('withholds workspace UI from an unassigned session (%s)', async (orgId) => {
    const html = await render({ id: 'user', email: 'operator@example.invalid', role: 'operator', orgId });
    expect(html).toContain('Workspace access pending');
    expect(html).toContain('operator@example.invalid');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('Workspace contents');
    expect(html).not.toContain('Primary navigation');
    expect(html).not.toContain('Studio owner');
  });

  it.each([['owner', 'Owner'], ['operator', 'Operator'], ['unexpected', 'Member']])(
    'uses the session role %s without inventing service health', async (role, label) => {
      const html = await render({ id: 'user', email: 'member@example.invalid', orgId: 'org', role });
      expect(html).toContain('Workspace contents');
      expect(html).toContain('Primary navigation');
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).not.toContain('All systems connected');
      expect(html).not.toContain('Studio owner');
    },
  );
});
