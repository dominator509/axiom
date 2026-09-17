import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import NavLinks from './NavLinks';
import ModelTabs from './ModelTabs';

const location = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }));

function pages(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return pages(join(directory, entry.name), `${prefix}/${entry.name}`);
    return entry.name === 'page.tsx' ? [prefix || '/'] : [];
  });
}

describe('workspace navigation coverage', () => {
  it('links every signed-in page through primary or talent navigation', () => {
    location.pathname = '/';
    const html = renderToStaticMarkup(<><NavLinks /><ModelTabs modelId="test-profile" /></>);
    const routes = pages(join(process.cwd(), 'app')).filter(route => route !== '/login');
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      expect(html, `Unlinked page: ${route}`).toContain(`href="${route.replace('[id]', 'test-profile')}"`);
    }
  });

  it.each(['/connections/grok', '/connections/grok/'])('identifies the Grok destination (%s)', pathname => {
    location.pathname = pathname;
    const html = renderToStaticMarkup(<NavLinks />);
    const link = html.match(/<a\b[^>]*href="\/connections\/grok"[^>]*>/)?.[0];
    expect(link).toContain('class="active"');
    expect(link).toContain('aria-current="page"');
  });

  it('does not activate a link for a coincidental path prefix', () => {
    location.pathname = '/audit-other';
    expect(renderToStaticMarkup(<NavLinks />)).not.toContain('aria-current');
  });

  it.each(['generation', 'media', 'consent', 'approvals', 'calendar', 'network', 'fans', 'linkbio', 'analytics', 'playbook'])('keeps talent identity when navigating to %s', section => {
    location.pathname = `/models/test-profile/${section}`;
    const html = renderToStaticMarkup(<ModelTabs modelId="test-profile" />);
    const link = html.match(new RegExp(`<a\\b[^>]*href="${location.pathname}"[^>]*>`))?.[0];
    expect(link).toContain('class="active"');
    expect(link).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
