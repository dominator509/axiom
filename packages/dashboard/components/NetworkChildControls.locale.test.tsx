import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NETWORK_CHILD_CONTROLS_CATALOGS, SUPPORTED_LOCALES } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import EgressCredentials from './EgressCredentials';
import NetworkHealth from './NetworkHealth';
import ActivateNetwork from './ActivateNetwork';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it.each(SUPPORTED_LOCALES)(
  'mounts network child controls from the shared catalog in %s',
  (locale) => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale={locale}>
        <EgressCredentials configId="config" mode="wireguard" />
        <NetworkHealth modelId="model" />
        <ActivateNetwork modelId="model" />
      </LocaleProvider>,
    );
    const catalog = NETWORK_CHILD_CONTROLS_CATALOGS[locale];
    expect(html).toContain(catalog['egress.credentialsTitleWireGuard']);
    expect(html).toContain(catalog['egress.importConfig']);
    expect(html).toContain(catalog['networkHealth.title']);
    expect(html).toContain(catalog['networkActivation.title']);
    expect(html).toContain('type="checkbox"');
  },
);
