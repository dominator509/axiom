import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }), headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RootLayout, { metadata } from './layout';
import LoginPage from './login/page';

afterEach(() => vi.unstubAllGlobals());

async function render(user: Record<string, unknown> | null, uiLocale = 'en') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/v1/ui-locale')) return new Response(JSON.stringify({ data: { locale: uiLocale } }));
    return new Response(JSON.stringify(user ? { user } : null));
  }));
  return renderToStaticMarkup(await RootLayout({ children: <p>Workspace contents</p> }));
}

describe('dashboard session presentation', () => {
  it('provides keyboard navigation directly to the signed-in page', async () => {
    const html = await render({ id: 'user', email: 'member@example.invalid', orgId: 'org', role: 'operator' });
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content" tabindex="-1"');
    expect(html).toContain('href="/connections/grok"');
  });
  it('uses FanThynks branding in metadata, navigation and login', async () => {
    expect(metadata.title).toEqual({ default: 'FanThynks — Creator OS', template: '%s · FanThynks' });
    const html = await render({ id: 'user', email: 'member@example.invalid', orgId: 'org', role: 'operator' });
    expect(html).toContain('FanThynks home');
    expect(html).toContain('brand-mark">F</span>');
    expect(html).not.toContain('AXIOM');
    const login = renderToStaticMarkup(<LoginPage />);
    expect(login).toContain('FanThynks introduction');
    expect(login).not.toContain('AXIOM');
  });
  it.each(['owner', 'manager', 'operator', 'unexpected'])(
    'mounts owner-only safety status only for an owner (%s)', async role => {
      const html = await render({ id: 'user', email: 'member@example.invalid', orgId: 'org', role });
      expect(html.includes('Checking workspace safety status')).toBe(role === 'owner');
    },
  );
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
  it('localizes the authenticated shell and role label', async () => {
    const html = await render({ id: 'user', email: 'miembro@example.invalid', orgId: 'org', role: 'content_creator' }, 'es');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Espacio de trabajo');
    expect(html).toContain('Creador de contenido');
    expect(html).toContain('Estado del sistema');
  });
});
