import { expect, it } from 'vitest';
import { CATALOGS } from './catalogs.js';
import { LocaleCatalog, SUPPORTED_LOCALES } from './locale.js';

/**
 * Bounded operator error-boundary copy for the agent-permission surface.
 *
 * These keys are the only strings AgentPermissionManager may render for a
 * non-success response or an uncertain failure. The backend-provided error
 * message is discarded at the boundary, so every operator-visible error state
 * must resolve to one of these catalog entries in every launch locale.
 */
export const AGENT_PERMISSION_ERROR_KEYS = [
  'agent.notAccepted',
  'agent.status.denied',
  'agent.status.notFound',
  'agent.status.invalid',
  'agent.status.conflict',
] as const;

it('covers every agent-permission error-boundary key in every launch locale', () => {
  const diagnostics: Array<{ type: string; key: string; locale: string }> = [];
  const catalog = new LocaleCatalog(CATALOGS, (event) => diagnostics.push(event));

  for (const locale of SUPPORTED_LOCALES) {
    for (const key of AGENT_PERMISSION_ERROR_KEYS) {
      const value = CATALOGS[locale][key];
      expect(value, `${locale}:${key}`).toBeTypeOf('string');
      expect(value.trim(), `${locale}:${key}`).not.toBe('');
      expect(catalog.t(locale, key), `${locale}:${key}`).not.toBe('');
      if (locale !== 'en') {
        expect(value, `${locale}:${key} must not fall back to English`).not.toBe(CATALOGS.en[key]);
      }
    }
  }

  expect(diagnostics).toEqual([]);
});
