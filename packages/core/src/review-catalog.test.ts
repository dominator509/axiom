import { describe, expect, it } from 'vitest';
import { REVIEW_CATALOGS, REVIEW_MESSAGE_KEYS, reviewCatalogIsComplete } from './review-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('review catalog', () => {
  it('covers every approval-queue key in every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(reviewCatalogIsComplete(locale)).toBe(true);
      expect(Object.keys(REVIEW_CATALOGS[locale]).sort()).toEqual([...REVIEW_MESSAGE_KEYS].sort());
    }
  });
});
