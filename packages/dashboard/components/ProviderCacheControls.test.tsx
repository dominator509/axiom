import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROVIDER_CACHE_CONTROL_CATALOGS, SUPPORTED_LOCALES } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import ProviderCacheControls from './ProviderCacheControls';

const controls = [
  { provider: 'deepseek', enabled: false, prefixAlignment: false, promptCacheKey: null },
  { provider: 'anthropic', enabled: false, prefixAlignment: false, promptCacheKey: null },
  { provider: 'openai', enabled: true, prefixAlignment: true, promptCacheKey: 'model:v1' },
];

it.each(SUPPORTED_LOCALES)('renders bounded cache controls from the shared catalog in %s', locale => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <ProviderCacheControls modelId="model" initialControls={controls} canEdit />
    </LocaleProvider>,
  );
  const catalog = PROVIDER_CACHE_CONTROL_CATALOGS[locale];
  expect(html).toContain(catalog['dashboard.cacheControls.title']);
  expect(html).toContain(catalog['dashboard.cacheControls.intro']);
  expect(html).toContain(catalog['dashboard.cacheControls.enabled']);
  expect(html).toContain(catalog['dashboard.cacheControls.prefixAlignment']);
  expect(html).toContain(catalog['dashboard.cacheControls.promptCacheKey']);
  expect(html).toContain(catalog['dashboard.cacheControls.save']);
  expect(html.match(/type="checkbox"/g)).toHaveLength(6);
  expect(html.match(/type="text"/g)).toHaveLength(3);
  expect(html).toContain('model:v1');
  expect(html).not.toContain('apiKey');
});

it('renders a read-only projection without save buttons', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderCacheControls modelId="model" initialControls={controls} canEdit={false} />
    </LocaleProvider>,
  );
  expect(html).toContain('You can view these controls but cannot change them.');
  expect(html).not.toContain('Save cache controls');
});
