import { expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale.js';
import { VIRAL_INSIGHT_CATALOGS } from './viral-insight-catalog.js';

const scheduleKeys = [
  'dashboard.viralInsight.scheduleTitle',
  'dashboard.viralInsight.scheduleDescription',
  'dashboard.viralInsight.scheduleEnabled',
  'dashboard.viralInsight.scheduleDisabled',
  'dashboard.viralInsight.scheduleSave',
  'dashboard.viralInsight.scheduleSaving',
  'dashboard.viralInsight.scheduleSaved',
  'dashboard.viralInsight.scheduleNotConfirmed',
  'dashboard.viralInsight.scheduleRetry',
  'dashboard.viralInsight.scheduleLoadError',
] as const;

it('provides non-empty recurring insight controls for all six launch locales', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of scheduleKeys) {
      expect(VIRAL_INSIGHT_CATALOGS[locale][key], `${locale}.${key}`).toBeTruthy();
      if (locale !== 'en') expect(VIRAL_INSIGHT_CATALOGS[locale][key], `${locale}.${key}`).not.toBe(VIRAL_INSIGHT_CATALOGS.en[key]);
    }
  }
});
