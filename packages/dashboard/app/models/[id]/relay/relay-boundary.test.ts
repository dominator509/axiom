import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the ops-hub #29 relay crash (AXIOM #36, digest
// 501188383). The relay route is a Server Component. It cannot pass a function
// (the server-built translator) as a prop across the RSC client boundary --
// React rejects non-serializable function props with "Functions cannot be
// passed directly to Client Components". RelayBindingManager is a Client
// Component and must obtain its translator from the client LocaleProvider
// instead.
const pagePath = fileURLToPath(new URL('./page.tsx', import.meta.url));
const managerPath = fileURLToPath(new URL('../../../../components/RelayBindingManager.tsx', import.meta.url));

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('relay client boundary (ops-hub #29)', () => {
  it('does not pass a function-valued t prop to RelayBindingManager', () => {
    const page = read(pagePath);
    expect(page).toMatch(/<RelayBindingManager/);
    // A `t={t}` (or any `t={`) prop on a Client Component from this Server
    // Component is a non-serializable boundary crossing.
    expect(page).not.toMatch(/<RelayBindingManager[^>]*\bt=\{/);
  });

  it('RelayBindingManager reads its translator from the client locale context', () => {
    const source = read(managerPath);
    expect(source).toMatch(/^'use client';/);
    expect(source).toMatch(/useLocale\(\)/);
    // It must not accept a translator prop any more.
    expect(source).not.toMatch(/t: Translator/);
  });
});
