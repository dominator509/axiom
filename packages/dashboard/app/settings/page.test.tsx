import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ role: 'owner', get: vi.fn(), uiGet: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: state.role } }), api: { orgSettings: { get: state.get }, uiLocale: { get: state.uiGet } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import SettingsPage from './page';
it('exposes language settings to members and keeps workspace settings owner-gated', async () => {
  state.uiGet.mockResolvedValue({ data: { locale: 'en', source: 'default', userLocale: null, orgLocale: null, supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'], canSetOrg: false } });
  state.role = 'viewer'; expect(renderToStaticMarkup(await SettingsPage())).toContain('Language');
  state.role = 'owner'; state.get.mockRejectedValue(new Error('unavailable')); expect(renderToStaticMarkup(await SettingsPage())).toContain('could not be loaded');
});
