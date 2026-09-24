import { describe, expect, it } from 'vitest';
import {
  PROFILE_NETWORK_LIFECYCLE_CATALOGS,
  PROFILE_NETWORK_LIFECYCLE_MESSAGE_KEYS,
  profileNetworkLifecycleCatalogIsComplete,
} from './profile-network-lifecycle-catalog.js';
import { SUPPORTED_LOCALES } from './locale.js';

describe('profile/network/lifecycle feature catalog', () => {
  it('covers every launch locale and feature key', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(profileNetworkLifecycleCatalogIsComplete(locale)).toBe(true);
      for (const key of PROFILE_NETWORK_LIFECYCLE_MESSAGE_KEYS) {
        expect(typeof PROFILE_NETWORK_LIFECYCLE_CATALOGS[locale][key], `${locale}.${key}`).toBe(
          'string',
        );
        expect(PROFILE_NETWORK_LIFECYCLE_CATALOGS[locale][key], `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('does not silently reuse the English control copy in launch locales', () => {
    const technicalKeys = new Set([
      'profile.avatarPlaceholder',
      'profile.handle',
      'network.mode.wireguard',
      'network.mode.vpn',
      'network.proxyPlaceholder',
      'network.expectedIpPlaceholder',
    ]);

    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== 'en')) {
      const untranslated = PROFILE_NETWORK_LIFECYCLE_MESSAGE_KEYS.filter(
        (key) =>
          !technicalKeys.has(key) &&
          PROFILE_NETWORK_LIFECYCLE_CATALOGS[locale][key] ===
            PROFILE_NETWORK_LIFECYCLE_CATALOGS.en[key],
      );
      expect(untranslated, `untranslated keys in ${locale}`).toEqual([]);
    }
  });
});
