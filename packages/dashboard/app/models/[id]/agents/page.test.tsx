import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  role: 'operator',
  agentPermissions: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { models: { agentPermissions: mocks.agentPermissions } },
  getSession: async () => ({ user: { role: mocks.role } }),
}));
vi.mock('@/lib/server-locale', () => ({
  getServerLocale: async () => ({
    t: (key: string) => ({
      'agent.accessTitle': 'Agent access',
      'agent.ownerRequired': 'Agent grants and token issuance require the workspace owner.',
      'agent.grantsDescription': 'Capability grants are model-scoped and owner-controlled.',
      'agent.accessUnavailable': 'Agent access unavailable',
      'agent.loadFailed': 'Agent grants could not be loaded.',
      'agent.noStateChanged': 'No permission or token state was changed.',
    }[key] ?? key),
  }),
}));
vi.mock('@/components/AgentPermissionManager', () => ({ default: () => null }));

import AgentPermissionsPage from './page';

async function renderPage() {
  const element = await AgentPermissionsPage({ params: Promise.resolve({ id: 'model-1' }) });
  return renderToStaticMarkup(element);
}

describe('agent permissions page authorization', () => {
  it('explains the owner-only limit to operators without making a forbidden request', async () => {
    mocks.role = 'operator';
    mocks.agentPermissions.mockReset();

    const html = await renderPage();

    expect(html).toContain('Agent access');
    expect(html).toContain('require the workspace owner');
    expect(html).not.toContain('Agent grants could not be loaded.');
    expect(mocks.agentPermissions).not.toHaveBeenCalled();
  });

  it('loads grants for the owner through the existing owner-only API', async () => {
    mocks.role = 'owner';
    mocks.agentPermissions.mockReset().mockResolvedValue({ data: [] });

    const html = await renderPage();

    expect(html).toContain('Agent access');
    expect(mocks.agentPermissions).toHaveBeenCalledOnce();
    expect(mocks.agentPermissions).toHaveBeenCalledWith('model-1');
  });
});
