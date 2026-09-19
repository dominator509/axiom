import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';
import type { CrashReport, DigestCard, OrgSettings, UiLocaleSnapshot } from '../api/endpoints';
import type { SessionUser } from '../api/auth';

// Only the data layer is stubbed; the dashboard surface under test is the real
// mounted component.
vi.mock('../api/auth', () => ({
  signOut: async () => undefined,
}));
vi.mock('../api/client', () => ({
  createIdempotencyKey: () => 'key-1',
}));
vi.mock('../api/endpoints', () => ({
  getOrgSettings: async () => null,
  getDigests: async () => ({ data: [] }),
  getCrashReports: async () => ({ data: [] }),
  getUiLocale: async () => null,
  patchViralSharing: async () => ({}),
  patchUiLocale: async () => ({}),
  generateDigest: async () => ({ jobId: 'job-1' }),
}));

import DashboardScreen, { DashboardView } from './DashboardScreen';

const catalog = new LocaleCatalog(CATALOGS);
const noop = () => {};

const user: SessionUser = { id: 'u1', email: 'd.man@example.com', role: 'owner' } as SessionUser;

const snapshot = (locale: SupportedLocale): UiLocaleSnapshot => ({
  locale,
  source: 'user',
  userLocale: locale,
  orgLocale: null,
  supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
  canSetOrg: true,
});

const settings: OrgSettings = { orgId: 'o1', publishingEnabled: true, viralSharing: false };

function render(overrides: Partial<React.ComponentProps<typeof DashboardView>> = {}) {
  return renderToStaticMarkup(
    <DashboardView
      user={user}
      settings={settings}
      uiLocale={snapshot('en')}
      digests={[]}
      crashReports={[]}
      loading={false}
      error={null}
      actionMessage={null}
      togglingViral={false}
      generating={false}
      savingLocale={false}
      onToggleViralSharing={noop}
      onSaveLocale={noop}
      onGenerateDigest={noop}
      onSignOut={noop}
      {...overrides}
    />,
  );
}

const digest = (over: Partial<DigestCard>): DigestCard => ({
  id: 'd1',
  title: 'Week 1',
  description: null,
  channel: 'relay',
  createdAt: '2026-01-02T03:04:05.000Z',
  config: {},
  externalDelivery: 'not-attempted',
  ...over,
});

const report = (over: Partial<CrashReport>): CrashReport => ({
  id: 'c1',
  fingerprint: 'fp',
  service: 'relay-worker',
  message: 'boom',
  count: 1,
  status: 'open',
  lastSeen: '2026-03-04T05:06:07.000Z',
  severity: 'sev-1',
  ...over,
});

it('mounts the default Dashboard screen component', () => {
  // The real default export mounts inside a React renderer; it starts in the
  // loading state before its effect resolves the locale and data.
  const html = renderToStaticMarkup(<DashboardScreen user={user} onSignOut={noop} />);
  expect(html).toContain(catalog.t('en', 'mobile.loadingDashboard'));
});

it('renders the dashboard, greeting and Language heading in the persisted Spanish locale', () => {
  const html = render({ uiLocale: snapshot('es') });
  expect(html).toContain(catalog.t('es', 'mobile.language'));
  expect(html).toContain(catalog.t('es', 'mobile.studioOverview'));
  expect(html).toContain(catalog.t('es', 'mobile.greeting', { name: 'd.man' }));
  expect(html).toContain(catalog.t('es', 'mobile.orgSettings'));
  expect(html).toContain(catalog.t('es', 'mobile.weeklyDigests'));
  expect(html).not.toContain(catalog.t('en', 'mobile.language'));
});

it('renders the dashboard in Japanese', () => {
  const html = render({ uiLocale: snapshot('ja') });
  expect(html).toContain(catalog.t('ja', 'mobile.language'));
  expect(html).toContain(catalog.t('ja', 'mobile.greeting', { name: 'd.man' }));
  expect(html).not.toContain(catalog.t('en', 'mobile.language'));
});

it('localizes the dashboard loading state', () => {
  const html = render({ uiLocale: snapshot('de'), loading: true });
  expect(html).toContain(catalog.t('de', 'mobile.loadingDashboard'));
  expect(html).not.toContain(catalog.t('en', 'mobile.loadingDashboard'));
});

it('formats digest and crash dates and counts with the selected locale, not the host default', () => {
  const html = render({
    uiLocale: snapshot('de'),
    digests: [digest({})],
    crashReports: [report({ count: 12345 })],
  });
  const expectedDigestDate = new Intl.DateTimeFormat('de', { timeZone: 'UTC' }).format(
    new Date('2026-01-02T03:04:05.000Z'),
  );
  const expectedReportDate = new Intl.DateTimeFormat('de', { timeZone: 'UTC' }).format(
    new Date('2026-03-04T05:06:07.000Z'),
  );
  expect(html).toContain(new Intl.NumberFormat('de').format(12345));
  expect(html).toContain(expectedDigestDate);
  expect(html).toContain(expectedReportDate);
});

it('keeps digest delivery states truthful from the API field', () => {
  const html = render({
    uiLocale: snapshot('en'),
    digests: [
      digest({ id: 'a', externalDelivery: 'not-attempted' }),
      digest({ id: 'b', externalDelivery: 'attempted' }),
      digest({ id: 'c', externalDelivery: 'unknown', channel: null }),
    ],
  });
  expect(html).toContain(catalog.t('en', 'mobile.storedOnly'));
  expect(html).toContain(catalog.t('en', 'mobile.dispatchAttempted'));
  expect(html).toContain(catalog.t('en', 'mobile.outcomeUnknown'));
  expect(html).toContain(catalog.t('en', 'mobile.unknownChannel'));
});

it('shows the localized empty digests and crash states', () => {
  const html = render({ uiLocale: snapshot('it') });
  expect(html).toContain(catalog.t('it', 'mobile.digestEmpty'));
  expect(html).toContain(catalog.t('it', 'mobile.noCrashes'));
});

it('keeps creator-authored digest titles and descriptions untranslated', () => {
  const html = render({
    uiLocale: snapshot('ja'),
    digests: [digest({ title: 'Creator Week', description: 'Authored summary' })],
  });
  expect(html).toContain('Creator Week');
  expect(html).toContain('Authored summary');
});

it('keeps the sign-out control available', () => {
  const html = render({ uiLocale: snapshot('en') });
  expect(html).toContain(catalog.t('en', 'mobile.signOut'));
});
