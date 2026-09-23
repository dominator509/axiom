import { expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale.js';
import { VIRAL_PATTERN_SHARING_CATALOGS } from './viral-pattern-sharing-catalog.js';

const sharingKeys = [
  'dashboard.performance.sharingTitle',
  'dashboard.performance.sharingDescription',
  'dashboard.performance.sharingEnabled',
  'dashboard.performance.sharingDisabled',
  'dashboard.performance.sharingSaved',
  'dashboard.performance.sharingSaving',
  'dashboard.performance.sharingSave',
  'dashboard.performance.sharingFailed',
  'dashboard.performance.sharingLoadFailed',
  'dashboard.performance.sharingScopeOrganization',
  'dashboard.performance.sharingScopeModel',
  'dashboard.performance.patternsSharedDescription',
  'dashboard.performance.dimensionsDescription',
] as const;

it('provides distinct pattern-sharing copy for all six launch locales', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of sharingKeys) {
      expect(VIRAL_PATTERN_SHARING_CATALOGS[locale][key], `${locale}.${key}`).toBeTruthy();
      if (locale !== 'en') {
        expect(VIRAL_PATTERN_SHARING_CATALOGS[locale][key], `${locale}.${key}`)
          .not.toBe(VIRAL_PATTERN_SHARING_CATALOGS.en[key]);
      }
    }
  }
});
