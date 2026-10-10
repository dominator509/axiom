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
      <ProviderCacheControls modelId="model" initialControls={controls} initialTelemetry={null} canEdit />
    </LocaleProvider>,
  );
  const catalog = PROVIDER_CACHE_CONTROL_CATALOGS[locale];
  expect(html).toContain(catalog['dashboard.cacheControls.title']);
  expect(html).toContain(catalog['dashboard.cacheControls.intro']);
  expect(html).toContain(catalog['dashboard.cacheControls.enabled']);
  expect(html).toContain(catalog['dashboard.cacheControls.prefixAlignment']);
  expect(html).toContain(catalog['dashboard.cacheControls.promptCacheKey']);
  expect(html).toContain(catalog['dashboard.cacheControls.save']);
  expect(html).toContain(catalog['dashboard.cacheControls.telemetryTitle']);
  expect(html).toContain(catalog['dashboard.cacheControls.telemetryIntro']);
  expect(html).toContain(catalog['dashboard.cacheControls.telemetryRefresh']);
  expect(html.match(/type="checkbox"/g)).toHaveLength(6);
  expect(html.match(/type="text"/g)).toHaveLength(3);
  expect(html).toContain('model:v1');
  expect(html).not.toContain('apiKey');
});

it('renders a read-only projection without save buttons', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderCacheControls modelId="model" initialControls={controls} initialTelemetry={null} canEdit={false} />
    </LocaleProvider>,
  );
  expect(html).toContain('You can view these controls but cannot change them.');
  expect(html).not.toContain('Save cache controls');
});

it('shows partial provider evidence without presenting a cache-hit rate', () => {
  const telemetry = {
    modelId: 'model', source: 'provider-reported' as const, status: 'partial' as const,
    observedResponses: 2, unobservedResponses: 1, promptTokens: 200, cachedPromptTokens: 190,
    cacheCreationPromptTokens: 0, cacheHitRate: null, windowStart: '2026-10-08', windowEnd: '2026-10-09',
    providers: [{
      provider: 'openai', status: 'partial' as const, successfulResponses: 3,
      observedResponses: 2, unobservedResponses: 1, promptTokens: 200,
      cachedPromptTokens: 190, cacheCreationPromptTokens: 0, cacheHitRate: null,
      windowStart: '2026-10-08', windowEnd: '2026-10-09',
    }],
  };
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderCacheControls modelId="model" initialControls={controls} initialTelemetry={telemetry} canEdit />
    </LocaleProvider>,
  );
  expect(html).toContain('Partial');
  expect(html).toContain('Unavailable until every successful response has usable counters');
  expect(html).toContain('Responses missing counters');
  expect(html).toContain('1');
});
