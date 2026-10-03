import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveTitle } from 'next/dist/lib/metadata/resolvers/resolve-title';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }), headers: async () => new Headers() }));
// next/font is compiled by Next; outside it the loader is a plain stub.
vi.mock('next/font/google', () => ({ Montserrat: () => ({ variable: 'font-montserrat', className: 'font-montserrat' }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RootLayout, { generateMetadata } from './layout';
import LoginPage, { generateMetadata as generateLoginMetadata } from './login/page';

afterEach(() => vi.unstubAllGlobals());

async function render(user: Record<string, unknown> | null, uiLocale = 'en') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/v1/ui-locale')) return new Response(JSON.stringify({ data: { locale: uiLocale } }));
    return new Response(JSON.stringify(user ? { user } : null));
  }));
  return renderToStaticMarkup(await RootLayout({ children: <p>Workspace contents</p> }));
}

describe('dashboard session presentation', () => {
  it('preserves title-template syntax in configured names literally', async () => {
    const brand = { name: 'Studio %s $& $$', tagline: null };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: brand })));
    const root = await generateMetadata();
    const login = await generateLoginMetadata();
    const template = typeof root.title === 'object' && root.title && 'template' in root.title ? root.title.template : null;
    expect(resolveTitle(root.title, null).absolute).toBe(brand.name + ' — Creator OS');
    expect(resolveTitle(login?.title, template).absolute).toBe('Sign in · ' + brand.name);
  });
  it('renders configured branding as text across metadata, navigation and login', async () => {
    const brand = { name: '<Studio & {email}>', tagline: 'Hello <world> & friends' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/brand')) return new Response(JSON.stringify({ data: brand }));
      if (String(input).includes('/api/v1/ui-locale')) return new Response(JSON.stringify({ data: { locale: 'en' } }));
      return new Response(JSON.stringify({ user: { id: 'u', email: 'member@example.invalid', orgId: 'org', role: 'operator' } }));
    }));
    const metadata = await generateMetadata();
    expect(metadata.applicationName).toBe(brand.name);
    expect(metadata.description).toBe(brand.tagline);
    const html = renderToStaticMarkup(await RootLayout({ children: <p>Workspace</p> }));
    expect(html).toContain('&lt;Studio &amp; {email}&gt;');
    expect(html).toContain('Hello &lt;world&gt; &amp; friends');
    expect(html).not.toContain('<Studio');
    expect(html).not.toContain('Fan<span>Thynks</span>');
    const login = renderToStaticMarkup(await LoginPage({}));
    expect(login).toContain('&lt;Studio &amp; {email}&gt;');
    expect(login).toContain('Hello &lt;world&gt; &amp; friends');
    expect(login).not.toContain('FanThynks account');
  });
  it('provides keyboard navigation directly to the signed-in page', async () => {
    const html = await render({ id: 'user', email: 'member@example.invalid', orgId: 'org', role: 'operator' });
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content" tabindex="-1"');
    expect(html).toContain('href="/connections/grok"');
  });
  it('uses FanThynks branding in metadata, navigation and login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { name: 'FanThynks', tagline: null } }))));
    const metadata = await generateMetadata();
    expect(metadata.title).toEqual({ absolute: 'FanThynks — Creator OS' });
    const html = await render({ id: 'user', email: 'member@example.invalid', orgId: 'org', role: 'operator' });
    expect(html).toContain('FanThynks home');
    expect(html).toContain('class="brand-mark" aria-hidden="true"><svg');
    expect(html).toContain('Fan<span>Thynks</span>');
    expect(html).not.toContain('AXIOM');
    const login = renderToStaticMarkup(await LoginPage({}));
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
    expect(html).toContain('<html lang="es" class="font-montserrat">');
    expect(html).toContain('Espacio de trabajo');
    expect(html).toContain('Creador de contenido');
    expect(html).toContain('Estado del sistema');
  });
});
