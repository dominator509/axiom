import { describe, expect, it } from 'vitest';
import {
  CONSENT_CATALOGS,
  CONSENT_MESSAGE_KEYS,
  consentCatalogIsComplete,
} from './consent-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('consent catalog', () => {
  it('covers every consent message in every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(consentCatalogIsComplete(locale)).toBe(true);
      for (const key of CONSENT_MESSAGE_KEYS) expect(CONSENT_CATALOGS[locale][key]).toBeTruthy();
    }
  });

  it('provides translated user-facing copy outside English', () => {
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== 'en')) {
      expect(CONSENT_CATALOGS[locale]['consent.title']).not.toBe(
        CONSENT_CATALOGS.en['consent.title'],
      );
      expect(CONSENT_CATALOGS[locale]['consent.save']).not.toBe(
        CONSENT_CATALOGS.en['consent.save'],
      );
    }
  });
});
