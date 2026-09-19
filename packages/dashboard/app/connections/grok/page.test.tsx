import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const session = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ getSession: session }));
vi.mock('@/components/GrokConnection', () => ({ default: () => <div>Own account connection controls</div> }));
vi.mock('@/components/GrokR2Storage', () => ({ default: () => <div>Storage credential controls</div> }));
import Page from './page';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';
it.each(['owner', 'manager', 'operator'])('retains generation connection and storage controls for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Own account connection controls');
  expect(html).toContain('Storage credential controls');
  expect(workspaceDestinationAllowed(role, '/connections/grok')).toBe(true);
});
it('shows Creator own-account connection and private storage controls', async () => {
  session.mockResolvedValue({ user: { role: 'content_creator' } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Own account connection controls');
  expect(html).toContain('Storage credential controls');
  expect(html).toContain('Storage is private to your account in this workspace');
});
it.each(['chatter', 'model', 'analyst', 'agent', 'unknown', undefined])('denies direct page controls and navigation for %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).not.toContain('Own account connection controls');
  expect(html).not.toContain('Storage credential controls');
  expect(html).toContain('Back to workspace');
  expect(workspaceDestinationAllowed(role, '/connections/grok')).toBe(false);
});
