import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), uiLocale: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.session, api: { killswitch: { get: mocks.get }, uiLocale: { get: mocks.uiLocale } } }));
vi.mock('@/components/KillSwitchControl', () => ({ default: () => <button>Safety controls</button> }));
import Page from './page';
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { role: 'owner' } }); mocks.uiLocale.mockResolvedValue({ data: { locale: 'en' } }); });
it.each(['manager', 'operator', 'viewer', undefined])('explains owner access without calling the restricted API for %s', async role => {
  mocks.session.mockResolvedValue({ user: { role } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Only a workspace owner');
  expect(mocks.get).not.toHaveBeenCalled();
  expect(html).not.toContain('Safety controls');
});
it('shows recovery without leaking backend errors or enabling controls', async () => {
  mocks.get.mockRejectedValue(new Error('internal database detail'));
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Reload safety status');
  expect(html).not.toContain('internal database detail');
  expect(html).not.toContain('Safety controls');
});
it('does not treat an invalid response as publishing enabled', async () => {
  mocks.get.mockResolvedValue({ data: {} });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('publishing state is unknown');
  expect(html).not.toContain('Safety controls');
});
it.each([true, false])('renders confirmed owner safety state %s', async enabled => {
  mocks.get.mockResolvedValue({ data: { enabled } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain(enabled ? 'HALTED' : 'Not halted');
  expect(html).toContain('Safety controls');
});
it('renders the owner safety surface in the persisted interface locale', async () => {
  mocks.uiLocale.mockResolvedValue({ data: { locale: 'es' } });
  mocks.get.mockResolvedValue({ data: { enabled: true, reason: 'review' , startedAt: '2026-09-19T12:00:00.000Z' } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Seguridad de publicación');
  expect(html).toContain('DETENIDA');
  expect(html).toContain('Usa el interruptor de emergencia');
  expect(html).not.toContain('Publishing safety');
});
