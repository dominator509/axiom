import { CATALOGS } from '@axiom/core';

export function testT(key: string, values?: Record<string, string | number>): string {
  const template = CATALOGS.en[key] ?? key;
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, name: string) => {
    const value = values?.[name];
    return value === undefined || value === null ? match : String(value);
  });
}
