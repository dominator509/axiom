import { describe, expect, it } from 'vitest';
import {
  FAN_CRM_CATALOGS,
  FAN_CRM_MESSAGE_KEYS,
  fanCrmCatalogIsComplete,
} from './fan-crm-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('fan CRM catalog', () => {
  it('covers every fan CRM message in every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(fanCrmCatalogIsComplete(locale)).toBe(true);
      for (const key of FAN_CRM_MESSAGE_KEYS) expect(FAN_CRM_CATALOGS[locale][key]).toBeTruthy();
    }
  });

  it('provides translated core controls outside English', () => {
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== 'en')) {
      expect(FAN_CRM_CATALOGS[locale]['fans.title']).not.toBe(FAN_CRM_CATALOGS.en['fans.title']);
      expect(FAN_CRM_CATALOGS[locale]['fans.save']).not.toBe(FAN_CRM_CATALOGS.en['fans.save']);
    }
  });
});
