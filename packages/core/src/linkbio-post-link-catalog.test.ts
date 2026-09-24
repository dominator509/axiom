import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locale.js';
import { LINKBIO_POST_LINK_CATALOGS, LINKBIO_POST_LINK_MESSAGE_KEYS } from './linkbio-post-link-catalog.js';

describe('per-post attribution link translations', () => {
  it('provides every post-link message in each supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of LINKBIO_POST_LINK_MESSAGE_KEYS) {
        expect(LINKBIO_POST_LINK_CATALOGS[locale][key], `${locale}:${key}`).toEqual(expect.any(String));
        expect(LINKBIO_POST_LINK_CATALOGS[locale][key]?.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });
});
