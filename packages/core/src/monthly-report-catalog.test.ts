import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale.js';
import { MONTHLY_REPORT_CATALOGS, MONTHLY_REPORT_KEYS, monthlyReportCatalogIsComplete } from './monthly-report-catalog.js';

describe('monthly report catalog', () => {
  it('covers every report key in every launch locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(monthlyReportCatalogIsComplete(locale)).toBe(true);
      for (const key of MONTHLY_REPORT_KEYS) {
        expect(MONTHLY_REPORT_CATALOGS[locale][key]).toEqual(expect.any(String));
        expect(MONTHLY_REPORT_CATALOGS[locale][key].length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the count placeholder in every metric label', () => {
    const metricKeys = MONTHLY_REPORT_KEYS.filter((key) => key.includes('scheduledPosts') || key.includes('publishedPosts') || key === 'monthlyReport.views' || key === 'monthlyReport.likes' || key === 'monthlyReport.shares' || key === 'monthlyReport.comments' || key.includes('adherenceScore') || key.includes('viralExemplars'));
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of metricKeys) expect(MONTHLY_REPORT_CATALOGS[locale][key]).toContain('{count}');
    }
  });
});
