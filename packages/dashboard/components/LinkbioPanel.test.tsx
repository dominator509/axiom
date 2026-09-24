import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refresh: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'de', setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
        'linkbio.kind': 'Kind', 'linkbio.primary': 'Primary', 'linkbio.clicks': 'Clicks',
        'linkbio.status': 'Status', 'linkbio.statusConfigured': 'Configured',
        'linkbio.statusConnected': 'Sync verified', 'linkbio.statusSyncError': 'Sync failed',
        'linkbio.statusDisabled': 'Disabled', 'linkbio.disable': 'Disable',
        'linkbio.trackedLinks': 'Tracked destination links', 'linkbio.noLinks': 'No links configured.',
        'linkbio.remove': 'Remove', 'linkbio.linkLabel': 'Link label', 'linkbio.linkUrl': 'Link URL',
        'linkbio.labelPlaceholder': 'Label', 'linkbio.urlPlaceholder': 'https://…',
        'linkbio.addLink': 'Add link', 'linkbio.retry': 'Retry same link-in-bio change',
        'linkbio.providerSelect': 'Provider', 'linkbio.profileUrl': 'Profile URL',
        'linkbio.accentColor': 'Accent color', 'linkbio.enableProvider': 'Enable provider',
        'linkbio.saveProvider': 'Save provider settings', 'linkbio.copyPublicPage': 'Copy public page URL',
        'linkbio.copyTrackedLink': 'Copy tracked redirect', 'linkbio.copied': 'Link copied.',
        'linkbio.externalSetup': 'External setup instructions', 'linkbio.externalProfileRequired': 'Profile URL required',
        'linkbio.analytics.unavailable': 'Analytics unavailable', 'linkbio.ga4.connectionUnavailable': 'Connection status unavailable',
        'linkbio.ga4.title': 'Google Analytics 4 import', 'linkbio.ga4.accessInstructions': 'GA4 access instructions',
        'linkbio.ga4.measurementId': 'GA4 measurement ID', 'linkbio.ga4.propertyId': 'GA4 property ID',
        'linkbio.ga4.clientEmail': 'Service account email', 'linkbio.ga4.privateKey': 'Service account private key',
        'linkbio.ga4.connect': 'Save GA4 connection', 'linkbio.ga4.disconnect': 'Remove saved credentials',
        'linkbio.ga4.disconnected': 'GA4 credentials removed', 'linkbio.ga4.savedUnverified': 'Credentials saved, not verified',
        'linkbio.ga4.syncSucceeded': 'GA4 imported {count} records', 'linkbio.ga4.startDate': 'Start date',
        'linkbio.ga4.endDate': 'End date', 'linkbio.ga4.sync': 'Sync analytics',
        'linkbio.ga4.syncError': 'Sync failed', 'linkbio.ga4.neverSynced': 'not synced yet',
        'linkbio.ga4.lastSynced': 'Last sync {date}', 'linkbio.ga4.ownerRequired': 'Owner or manager required',
        'linkbio.roleRequired': 'Link-in-bio changes require an owner, manager or operator role.',
        'linkbio.error.enableFailed': 'Enable failed', 'linkbio.error.unconfirmed': 'Unconfirmed link-in-bio change',
        'linkbio.error.notConfirmed': 'Change not confirmed. Retry the same link-in-bio change.',
        'linkbio.error.labelAndUrlRequired': 'A link label and URL are required',
        'linkbio.error.limits': 'Link labels must be at most 120 characters and URLs at most 2048 characters.',
        'linkbio.error.httpsRequired': 'Links must use an http(s) URL',
        'linkbio.error.profileUrl': 'Enter an HTTPS URL on the selected provider domain.',
        'linkbio.error.copyFailed': 'The link could not be copied.',
      } as Record<string, string>)[key] ?? key;
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, name: string) => String(values?.[name] ?? `{${name}}`));
    },
  }),
}));

import LinkbioPanel from './LinkbioPanel';

beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function panel(enabled: boolean, canEdit = true) {
  hooks.index = 0;
  return LinkbioPanel({ modelId: 'model', canEdit, providers: [{
    id: 'native', kind: 'native', enabled, isPrimary: false, status: 'configured', clicks: 1234,
    config: { metadata: { source: 'saved-configuration' }, links: [{
      label: 'Saved destination', url: 'https://example.com/saved', path: '/linkbio/model/s/saved-link',
    }] },
  }] });
}

function findButton(element: ReactElement, label: string): ReactElement<{ onClick: () => Promise<void> }> | undefined {
  const props = element.props as { children?: unknown };
  if (element.type === 'button' && props.children === label) return element as ReactElement<{ onClick: () => Promise<void> }>;
  for (const child of [props.children].flat(Infinity)) {
    if (child && typeof child === 'object' && 'props' in child) {
      const found = findButton(child as ReactElement, label);
      if (found) return found;
    }
  }
}

it('does not offer an enable action while the native page is already active', () => {
  expect(findButton(panel(true), 'Enable provider')).toBeUndefined();
});

it('formats provider click counts in the selected locale', () => {
  expect(renderToStaticMarkup(panel(true))).toContain('1.234');
});

it('does not expose provider mutations to read-only users', () => {
  const html = renderToStaticMarkup(panel(false, false));
  expect(html).not.toContain('Enable provider');
  expect(html).toContain('Link-in-bio changes require an owner, manager or operator role.');
});

it('preserves unrelated settings while saving updated tracked destinations', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { kind: 'native', enabled: true } }), { status: 201, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  panel(true);
  hooks.values[6] = [{ label: 'Updated', url: 'https://example.com/new' }];
  await findButton(panel(true), 'Save provider settings')!.props.onClick();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    kind: 'native', isPrimary: false,
    config: { metadata: { source: 'saved-configuration' }, links: [{ label: 'Updated', url: 'https://example.com/new' }] },
  });
});

it.each([
  ['x'.repeat(121), 'https://example.com', '120'],
  ['Label', `https://example.com/${'x'.repeat(2048)}`, '2048'],
])('rejects destination entries the public renderer would omit', async (label, url, limit) => {
  panel(true);
  const savedLinks = hooks.values[6];
  hooks.values[15] = label;
  hooks.values[16] = url;
  await findButton(panel(true), 'Add link')!.props.onClick();
  expect(hooks.values[3]).toEqual(expect.stringContaining(limit));
  expect(hooks.values[6]).toBe(savedLinks);
});

it('accepts labels and URLs at the public renderer limits', async () => {
  panel(true);
  const label = 'x'.repeat(120);
  const url = 'https://example.com/'.padEnd(2048, 'x');
  hooks.values[15] = label;
  hooks.values[16] = url;
  await findButton(panel(true), 'Add link')!.props.onClick();
  expect(hooks.values[3]).toBeNull();
  expect(hooks.values[6]).toEqual(expect.arrayContaining([{ label, url }]));
});

it('enables an unconfigured provider and triggers a server readback', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { kind: 'native', enabled: true } }), { status: 201, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await findButton(panel(false), 'Enable provider')!.props.onClick();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    kind: 'native', config: { links: [{ label: 'Saved destination', url: 'https://example.com/saved' }] },
  });
  await vi.waitFor(() => expect(hooks.refresh).toHaveBeenCalledOnce());
  expect(renderToStaticMarkup(panel(true))).toContain('Saved destination');
});

it('renders provider management and tracked-link copy controls', () => {
  const html = renderToStaticMarkup(panel(true, true));
  expect(html).toContain('Kind');
  expect(html).toContain('Primary');
  expect(html).toContain('Clicks');
  expect(html).toContain('Disable');
  expect(html).toContain('Tracked destination links');
  expect(html).toContain('Copy tracked redirect');
  expect(html).toContain('Copy public page URL');
});

it('validates malformed destination URLs before saving', async () => {
  panel(true);
  hooks.values[15] = 'Label';
  hooks.values[16] = 'ftp://example.com';
  await findButton(panel(true), 'Add link')!.props.onClick();
  expect(hooks.values[3]).toBe('Links must use an http(s) URL');
});

it('requires a label and destination before adding a link', async () => {
  panel(true);
  hooks.values[15] = '';
  hooks.values[16] = '';
  await findButton(panel(true), 'Add link')!.props.onClick();
  expect(hooks.values[3]).toBe('A link label and URL are required');
});
