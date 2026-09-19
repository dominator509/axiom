import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ role: 'operator', locale: 'en', crashes: vi.fn(), jobs: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: state.role } }), api: { uiLocale: { get: vi.fn(async () => ({ data: { locale: state.locale } })) }, incidents: { crashes: state.crashes, list: state.jobs } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import IncidentsPage from './page';
beforeEach(() => {
  state.role = 'operator'; state.locale = 'en'; state.crashes.mockReset(); state.jobs.mockReset();
  state.crashes.mockResolvedValue({ data: [{ id: 'crash', service: 'worker', message: '<script>bad</script>', severity: 'sev-2', count: 2, status: 'open', lastSeen: '2026-09-15' }], meta: { next_cursor: 'older token' } });
  state.jobs.mockResolvedValue({ data: [{ id: 'job', kind: 'publish.target', state: 'dead', lastError: 'external-side-effect-unknown: reconcile', createdAt: '2026-09-15' }] });
});
it('renders escaped crash details and resolve controls, but not unsafe replay', async () => {
  const html = renderToStaticMarkup(await IncidentsPage({}));
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('Mark resolved');
  expect(html).toContain('Reconcile provider outcome before replay'); expect(html).not.toContain('>Replay<');
  expect(html).toContain('crashCursor=older+token');
});
it('preserves status across pagination and hides mutations from read-only users', async () => {
  state.role = 'viewer';
  const html = renderToStaticMarkup(await IncidentsPage({ searchParams: Promise.resolve({ status: 'resolved', crashCursor: 'cursor' }) }));
  expect(state.crashes).toHaveBeenCalledWith('resolved', 'cursor');
  expect(html).toContain('status=resolved'); expect(html).not.toContain('Mark resolved');
});
it('keeps independent failures explicit without claiming queue health', async () => {
  state.crashes.mockRejectedValue(new Error('down')); state.jobs.mockResolvedValue({ data: [] });
  const html = renderToStaticMarkup(await IncidentsPage({}));
  expect(html).toContain('Crash reports could not be loaded'); expect(html).not.toContain('All queues healthy');
  expect(html).not.toContain('No open crash reports');
});
it('paginates jobs independently without losing the crash filter or cursor', async () => {
  state.jobs.mockResolvedValue({ data: [], meta: { next_cursor: 'older jobs' } });
  const html = renderToStaticMarkup(await IncidentsPage({ searchParams: Promise.resolve({ status: 'resolved', crashCursor: 'crash-page', jobCursor: 'job-page' }) }));
  expect(state.jobs).toHaveBeenCalledWith('job-page');
  expect(html).toContain('status=resolved&amp;crashCursor=crash-page&amp;jobCursor=older+jobs');
  expect(html).toContain('href="/incidents?status=resolved&amp;crashCursor=crash-page">Latest failed jobs');
  expect(html).toContain('status=resolved&amp;crashCursor=older+token&amp;jobCursor=job-page');
  expect(html).toContain('href="/incidents?status=open&amp;jobCursor=job-page"');
});
it('does not forward ambiguous cursor values', async () => {
  await IncidentsPage({ searchParams: Promise.resolve({ crashCursor: ['one', 'two'], jobCursor: ['one', 'two'] }) });
  expect(state.jobs).toHaveBeenCalledWith(undefined);
  expect(state.crashes).toHaveBeenCalledWith('open', undefined);
});
it('renders incidents and dates through the selected locale', async () => {
  state.locale = 'es';
  const html = renderToStaticMarkup(await IncidentsPage({}));
  expect(html).toContain('Incidentes y recuperación');
  expect(html).toContain('Informes de errores de la aplicación');
  expect(html).toContain('Última vez:');
  expect(html).not.toContain('Incidents &amp; recovery');
});
