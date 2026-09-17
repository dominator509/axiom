import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ role: 'owner', get: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: state.role } }), api: { orgSettings: { get: state.get } } }));
import SettingsPage from './page';
it('exposes settings only to owners and renders an explicit load failure', async () => {
  state.role = 'viewer'; expect(renderToStaticMarkup(await SettingsPage())).toContain('Only a workspace owner');
  state.role = 'owner'; state.get.mockRejectedValue(new Error('unavailable')); expect(renderToStaticMarkup(await SettingsPage())).toContain('could not be loaded');
});
