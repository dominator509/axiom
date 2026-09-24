import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONSENT_CATALOGS, SUPPORTED_LOCALES } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import RevokeConsentButton from './RevokeConsentButton';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('RevokeConsentButton localization', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`renders revoke controls in ${locale}`, () => {
      const html = renderToStaticMarkup(
        <LocaleProvider initialLocale={locale}>
          <RevokeConsentButton modelId="model" recordId="record" />
        </LocaleProvider>,
      );
      expect(html).toContain(CONSENT_CATALOGS[locale]['consent.revoke']);
    });
  }
});
