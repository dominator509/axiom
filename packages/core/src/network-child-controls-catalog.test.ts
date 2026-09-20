import { expect, it } from 'vitest';
import {
  NETWORK_CHILD_CONTROLS_CATALOGS,
  NETWORK_CHILD_CONTROLS_MESSAGE_KEYS,
  networkChildControlsCatalogIsComplete,
} from './network-child-controls-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

it.each(SUPPORTED_LOCALES)('covers every network child control key in %s', (locale) => {
  expect(networkChildControlsCatalogIsComplete(locale)).toBe(true);
  expect(Object.keys(NETWORK_CHILD_CONTROLS_CATALOGS[locale]).sort()).toEqual(
    [...NETWORK_CHILD_CONTROLS_MESSAGE_KEYS].sort(),
  );
  for (const key of NETWORK_CHILD_CONTROLS_MESSAGE_KEYS) {
    expect(NETWORK_CHILD_CONTROLS_CATALOGS[locale][key], `${locale}.${key}`).toEqual(
      expect.any(String),
    );
    expect(NETWORK_CHILD_CONTROLS_CATALOGS[locale][key], `${locale}.${key}`).not.toBe('');
  }
});
