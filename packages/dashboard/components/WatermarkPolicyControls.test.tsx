import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WATERMARK_POLICY_CATALOGS, SUPPORTED_LOCALES } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import WatermarkPolicyControls from './WatermarkPolicyControls';

const policy = { enabled: true, watermarkKey: 'generated/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/wm.png', position: 'top-left', opacity: 40, scale: 50 };
const disabled = { enabled: false, watermarkKey: null, position: 'bottom-right', opacity: 60, scale: 100 };

it.each(SUPPORTED_LOCALES)('renders bounded watermark controls from the shared catalog in %s', locale => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <WatermarkPolicyControls modelId="model" initialPolicy={policy} canEdit />
    </LocaleProvider>,
  );
  const catalog = WATERMARK_POLICY_CATALOGS[locale];
  expect(html).toContain(catalog['dashboard.watermark.title']);
  expect(html).toContain(catalog['dashboard.watermark.intro']);
  expect(html).toContain(catalog['dashboard.watermark.enabled']);
  expect(html).toContain(catalog['dashboard.watermark.position']);
  expect(html).toContain(catalog['dashboard.watermark.opacity']);
  expect(html).toContain(catalog['dashboard.watermark.scale']);
  expect(html).toContain(catalog['dashboard.watermark.watermarkKey']);
  expect(html).toContain(catalog['dashboard.watermark.save']);
  expect(html).toContain(catalog['dashboard.watermark.position.top-left']);
  expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  expect(html.match(/type="number"/g)).toHaveLength(2);
  expect(html).toContain('generated/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/wm.png');
  expect(html).not.toContain('cdnUrl');
});

it.each(SUPPORTED_LOCALES)('exposes the six-locale catalog keys used by the component', locale => {
  const catalog = WATERMARK_POLICY_CATALOGS[locale];
  for (const key of [
    'dashboard.watermark.title', 'dashboard.watermark.intro', 'dashboard.watermark.enabled',
    'dashboard.watermark.position.top-left', 'dashboard.watermark.position.top-right',
    'dashboard.watermark.position.bottom-left', 'dashboard.watermark.position.bottom-right',
    'dashboard.watermark.position.center', 'dashboard.watermark.opacity', 'dashboard.watermark.scale',
    'dashboard.watermark.watermarkKey', 'dashboard.watermark.keyHint', 'dashboard.watermark.save',
    'dashboard.watermark.saving', 'dashboard.watermark.saved', 'dashboard.watermark.notConfirmed',
    'dashboard.watermark.unavailable', 'dashboard.watermark.readOnly', 'dashboard.watermark.invalidKey',
    'dashboard.watermark.disabledNote', 'dashboard.watermark.empty',
    'dashboard.watermark.bounds.opacity', 'dashboard.watermark.bounds.scale',
  ]) {
    expect(catalog[key], `${locale} is missing ${key}`).toBeTruthy();
  }
});

it('renders a read-only projection without save buttons', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <WatermarkPolicyControls modelId="model" initialPolicy={policy} canEdit={false} />
    </LocaleProvider>,
  );
  expect(html).toContain('You can view these controls but cannot change them.');
  expect(html).not.toContain('Save watermark');
});

it('renders the disabled note and empty state for an untouched policy', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <WatermarkPolicyControls modelId="model" initialPolicy={disabled} canEdit />
    </LocaleProvider>,
  );
  expect(html).toContain('No watermark is configured for this model yet.');
  expect(html).toContain('Disabled means no watermark is composited.');
});
