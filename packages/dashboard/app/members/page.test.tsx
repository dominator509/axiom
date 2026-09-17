import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const session = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ getSession: session }));
vi.mock('@/components/WorkspaceMembers', () => ({ default: () => <div>Member administration</div> }));
import Page from './page';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';
it.each(['operator', 'manager', 'analyst', 'agent', 'model', 'chatter', 'content_creator', undefined])('denies member controls and navigation to %s', async role => {
  session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Only a workspace owner'); expect(html).not.toContain('Member administration');
  expect(workspaceDestinationAllowed(role, '/members')).toBe(false);
});
it('makes owner administration discoverable', async () => {
  session.mockResolvedValue({ user: { role: 'owner' } });
  expect(renderToStaticMarkup(await Page())).toContain('Member administration');
  expect(workspaceDestinationAllowed('owner', '/members')).toBe(true);
});
