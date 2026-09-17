import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), operations: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { models: { teamOperations: mocks.operations } } }));
vi.mock('@/components/TeamOperationsManager', () => ({ default: () => <p>Shift controls</p> }));
vi.mock('@/components/ModelAssignments', () => ({ default: () => <p>Owner assignments</p> }));
import Page from './page';
beforeEach(() => { vi.clearAllMocks(); mocks.operations.mockResolvedValue({ data: { members: [], shifts: [], notes: [] } }); });
it.each(['owner', 'manager', 'operator', 'analyst', 'agent', undefined])('shows assignment management only for owner, role=%s', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'model' }) }));
  expect(html.includes('Owner assignments')).toBe(role === 'owner');
  expect(html).toContain('Shift controls');
});
