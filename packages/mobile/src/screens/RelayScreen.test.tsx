import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
import type { CrashReport, DigestCard } from '../api/endpoints';

// Only the data layer is stubbed; the Relay surface under test is the real
// mounted component.
vi.mock('../api/endpoints', () => ({
  getDigests: async () => ({ data: [] }),
  getCrashReports: async () => ({ data: [] }),
  getUiLocale: async () => ({
    locale: 'en',
    source: 'user',
    userLocale: 'en',
    orgLocale: null,
    supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
    canSetOrg: false,
  }),
  getOrgSettings: async () => null,
  patchViralSharing: async () => ({}),
  patchUiLocale: async () => ({}),
  generateDigest: async () => ({ jobId: 'job-1' }),
}));

import RelayScreen, { RelayView } from './RelayScreen';

const catalog = new LocaleCatalog(CATALOGS);
const noop = () => {};

function render(overrides: Partial<React.ComponentProps<typeof RelayView>> = {}) {
  return renderToStaticMarkup(
    <RelayView
      locale="en"
      digests={[]}
      crashReports={[]}
      loading={false}
      refreshing={false}
      error={null}
      onRefresh={noop}
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

beforeEach(() => {
  vi.resetModules();
});

it('mounts the default Relay screen component', () => {
  // The real default export mounts inside a React renderer; it starts in the
  // loading state before its effect resolves the locale and data.
  const html = renderToStaticMarkup(<RelayScreen />);
  expect(html).toContain(catalog.t('en', 'mobile.relayLoading'));
});

it('renders the Relay surface in the persisted Spanish locale', () => {
  const html = render({ locale: 'es' });
  expect(html).toContain(catalog.t('es', 'mobile.relayTitle'));
  expect(html).toContain(catalog.t('es', 'mobile.relayEyebrow'));
  expect(html).toContain(catalog.t('es', 'mobile.relaySubtitle'));
  expect(html).toContain(catalog.t('es', 'mobile.incidents'));
  expect(html).toContain(catalog.t('es', 'mobile.digestCards'));
  expect(html).not.toContain(catalog.t('en', 'mobile.relayTitle'));
});

it('renders the Relay surface in Japanese', () => {
  const html = render({ locale: 'ja' });
  expect(html).toContain(catalog.t('ja', 'mobile.relayTitle'));
  expect(html).toContain(catalog.t('ja', 'mobile.incidents'));
  expect(html).toContain(catalog.t('ja', 'mobile.digestCards'));
  expect(html).not.toContain(catalog.t('en', 'mobile.relayTitle'));
});

it('localizes the Relay loading state', () => {
  const html = render({ locale: 'de', loading: true });
  expect(html).toContain(catalog.t('de', 'mobile.relayLoading'));
  expect(html).not.toContain(catalog.t('en', 'mobile.relayLoading'));
});

it('shows truthful empty states rather than fabricated data', () => {
  const html = render({ locale: 'de' });
  expect(html).toContain(catalog.t('de', 'mobile.noIncidents'));
  expect(html).toContain(catalog.t('de', 'mobile.noDigestCards'));
});

it('formats incident dates and counts with the selected locale, not the host default', () => {
  const html = render({ locale: 'de', crashReports: [report({ count: 12345 })] });
  const expectedDate = new Intl.DateTimeFormat('de', { timeZone: 'UTC' }).format(
    new Date('2026-03-04T05:06:07.000Z'),
  );
  // de groups the count with a dot (12.345); the host default would be 12,345.
  expect(html).toContain(new Intl.NumberFormat('de').format(12345));
  expect(html).toContain(expectedDate);
});

it('formats Japanese dates with the selected locale', () => {
  const html = render({ locale: 'ja', digests: [digest({})] });
  const expectedDate = new Intl.DateTimeFormat('ja', { timeZone: 'UTC' }).format(
    new Date('2026-01-02T03:04:05.000Z'),
  );
  expect(html).toContain(expectedDate);
});

it('keeps digest delivery states truthful from the API field', () => {
  const html = render({
    locale: 'en',
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

it('surfaces load failure rather than disguising it as an empty relay', () => {
  const html = render({ locale: 'en', error: 'relay down' });
  expect(html).toContain('relay down');
});

it('keeps creator-authored service and message text untranslated', () => {
  const html = render({
    locale: 'ja',
    crashReports: [report({ service: 'Creator Service', message: 'Provider said no' })],
  });
  expect(html).toContain('Creator Service');
  expect(html).toContain('Provider said no');
  expect(html).toContain(catalog.t('ja', 'mobile.incidents'));
});
