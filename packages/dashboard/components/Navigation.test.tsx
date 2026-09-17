import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import NavLinks from './NavLinks';
import ModelTabs from './ModelTabs';
import { roleLabel } from '@/lib/navigation-role';

const location = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }));

function pages(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return pages(join(directory, entry.name), `${prefix}/${entry.name}`);
    return entry.name === 'page.tsx' ? [prefix || '/'] : [];
  });
}

describe('workspace navigation coverage', () => {
  it.each(['manager', 'operator', 'analyst', 'agent', 'chatter', 'content_creator', 'model', undefined])('keeps owner settings out of primary navigation for %s', role => {
    const html = renderToStaticMarkup(<NavLinks role={role} />);
    expect(html).not.toContain('href="/killswitch"');
    expect(html).not.toContain('href="/settings"');
    if (!role || ['chatter', 'content_creator', 'model'].includes(role)) {
      expect(html.match(/href="/g)).toHaveLength(1);
      expect(html).toContain('href="/"');
    }
  });
  it.each([
    ['chatter', ['', 'fans']],
    ['content_creator', ['', 'generation', 'media', 'approvals', 'calendar', 'analytics', 'playbook']],
    ['model', ['', 'media', 'calendar', 'fans', 'analytics']],
  ] as const)('shows precisely the relevant talent destinations for %s', (role, sections) => {
    const html = renderToStaticMarkup(<ModelTabs modelId="assigned" role={role} />);
    const paths = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(paths).toEqual(sections.map(section => `/models/assigned${section ? `/${section}` : ''}`));
    if (role === 'content_creator') { expect(html).toContain('Review drafts'); expect(html).not.toContain('Review &amp; approve'); }
  });
  it('uses explicit role names and minimal navigation for unknown roles', () => {
    expect(roleLabel('content_creator')).toBe('Content Creator');
    expect(roleLabel('chatter')).toBe('Chatter');
    expect(roleLabel('__proto__')).toBe('Member');
    expect(renderToStaticMarkup(<ModelTabs modelId="assigned" role="unknown" />).match(/href="/g)).toHaveLength(1);
  });
  it('links every signed-in page through primary or talent navigation', () => {
    location.pathname = '/';
    const html = renderToStaticMarkup(<><NavLinks role="owner" /><ModelTabs modelId="test-profile" role="owner" /></>);
    const routes = pages(join(process.cwd(), 'app')).filter(route => route !== '/login');
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      expect(html, `Unlinked page: ${route}`).toContain(`href="${route.replace('[id]', 'test-profile')}"`);
    }
  });

  it.each(['/connections/grok', '/connections/grok/'])('identifies the Grok destination (%s)', pathname => {
    location.pathname = pathname;
    const html = renderToStaticMarkup(<NavLinks role="owner" />);
    const link = html.match(/<a\b[^>]*href="\/connections\/grok"[^>]*>/)?.[0];
    expect(link).toContain('class="active"');
    expect(link).toContain('aria-current="page"');
  });

  it('does not activate a link for a coincidental path prefix', () => {
    location.pathname = '/audit-other';
    expect(renderToStaticMarkup(<NavLinks role="owner" />)).not.toContain('aria-current');
  });

  it.each(['generation', 'media', 'consent', 'approvals', 'calendar', 'network', 'fans', 'linkbio', 'analytics', 'playbook'])('keeps talent identity when navigating to %s', section => {
    location.pathname = `/models/test-profile/${section}`;
    const html = renderToStaticMarkup(<ModelTabs modelId="test-profile" role="owner" />);
    const link = html.match(new RegExp(`<a\\b[^>]*href="${location.pathname}"[^>]*>`))?.[0];
    expect(link).toContain('class="active"');
    expect(link).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
