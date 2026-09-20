import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelOverviewPage from './page';
import { api, getSession } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ getSession: vi.fn(), api: { models: {
  get: vi.fn(), network: vi.fn(), calendar: vi.fn(), fans: vi.fn(),
}, uiLocale: { get: vi.fn() } } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { role: 'operator' } } as Awaited<ReturnType<typeof getSession>>);
  vi.mocked(api.uiLocale.get).mockResolvedValue({ data: { locale: 'en' } } as Awaited<ReturnType<typeof api.uiLocale.get>>);
  vi.mocked(api.models.get).mockResolvedValue({ data: {
    id: 'talent', displayName: 'Creator', handle: 'creator', bio: 'Profile', createdAt: '2026-09-15',
  } } as Awaited<ReturnType<typeof api.models.get>>);
  vi.mocked(api.models.network).mockRejectedValue(new Error('Unavailable'));
  vi.mocked(api.models.calendar).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.models.calendar>>);
  vi.mocked(api.models.fans).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.models.fans>>);
});

const render = async () => renderToStaticMarkup(await ModelOverviewPage({ params: Promise.resolve({ id: 'talent' }) }));

describe('talent overview recovery and navigation', () => {
  it('shows profile editing only to operational roles', async () => {
    expect(await render()).toContain('Edit profile details');
    vi.mocked(getSession).mockResolvedValue({ user: { role: 'viewer' } } as Awaited<ReturnType<typeof getSession>>);
    expect(await render()).not.toContain('Edit profile details');
  });
  it('links summaries and next actions to this talent workspace', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { role: 'owner' } } as Awaited<ReturnType<typeof getSession>>);
    const html = await render();
    for (const route of ['network', 'calendar', 'fans', 'generation', 'approvals', 'media', 'consent', 'linkbio', 'analytics', 'playbook', 'relay', 'agents', 'cascades']) {
      expect(html).toContain(`href="/models/talent/${route}"`);
    }
  });
  it('keeps legitimate empty counts without inventing network configuration state', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { role: 'owner' } } as Awaited<ReturnType<typeof getSession>>);
    const html = await render();
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(2);
    expect(html).toContain('Network status could not be loaded.');
    expect(html).not.toContain('No network configuration yet.');
  });
  it('never presents failed count requests as zero activity', async () => {
    vi.mocked(api.models.calendar).mockRejectedValue(new Error('Unavailable'));
    vi.mocked(api.models.fans).mockRejectedValue(new Error('Unavailable'));
    const html = await render();
    expect(html.match(/<strong>Unavailable<\/strong>/g)).toHaveLength(2);
    expect(html).not.toContain('<strong>0</strong>');
  });
  it('offers a way back without falsely claiming a missing profile on a request failure', async () => {
    vi.mocked(api.models.get).mockRejectedValue(new Error('Unavailable'));
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('Model not found');
    expect(api.models.network).not.toHaveBeenCalled();
    expect(api.models.calendar).not.toHaveBeenCalled();
    expect(api.models.fans).not.toHaveBeenCalled();
  });
  it('uses the persisted locale for route-shell copy and UTC dates', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { role: 'owner' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(api.uiLocale.get).mockResolvedValue({ data: { locale: 'es' } } as Awaited<ReturnType<typeof api.uiLocale.get>>);
    const html = await render();
    expect(html).toContain('Perfil');
    expect(html).toContain('Red y seguridad');
    expect(html).toContain('Creado');
    expect(html).not.toContain('Network &amp; security');
    expect(html).not.toContain('View schedule');
  });
  it.each([
    ['content_creator', ['calendar', 'generation', 'approvals', 'media', 'analytics', 'playbook']],
    ['model', ['calendar', 'fans', 'media', 'analytics']],
    ['chatter', ['fans', 'roleplay']],
    ['unknown', []],
  ] as const)('matches scoped destinations and queries for %s', async (role, expected) => {
    vi.mocked(getSession).mockResolvedValue({ user: { role } } as Awaited<ReturnType<typeof getSession>>);
    const html = await render();
    const routes = [...html.matchAll(/href="\/models\/talent\/([^"]+)"/g)].map(match => match[1]);
    expect(routes.sort()).toEqual([...expected].sort());
    expect(api.models.network).not.toHaveBeenCalled();
    expect(api.models.calendar).toHaveBeenCalledTimes(expected.some(value => value === 'calendar') ? 1 : 0);
    expect(api.models.fans).toHaveBeenCalledTimes(expected.some(value => value === 'fans') ? 1 : 0);
    expect(html).not.toContain('Network &amp; security');
    expect(html).not.toContain('Edit profile details');
  });
  it.each(['manager', 'operator', 'analyst', 'agent'])('does not load owner-only network data for %s', async role => {
    vi.mocked(getSession).mockResolvedValue({ user: { role } } as Awaited<ReturnType<typeof getSession>>);
    const html = await render();
    expect(api.models.network).not.toHaveBeenCalled();
    expect(html).not.toContain('/network');
    expect(html).not.toContain('/agents');
  });
});
