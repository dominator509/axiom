import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONSENT_CATALOGS, SUPPORTED_LOCALES } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import ConsentRecordForm from './ConsentRecordForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('ConsentRecordForm localization', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`renders consent controls in ${locale}`, () => {
      const html = renderToStaticMarkup(
        <LocaleProvider initialLocale={locale}>
          <ConsentRecordForm modelId="model" />
        </LocaleProvider>,
      );
      expect(html).toContain(CONSENT_CATALOGS[locale]['consent.addMetadata']);
      expect(html).toContain(CONSENT_CATALOGS[locale]['consent.save']);
    });
  }
});
