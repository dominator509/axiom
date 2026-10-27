import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the ops-hub #29 calendar crash (AXIOM #36, digest
// 690433473). The calendar route is a Server Component; `CalendarOptimalTimes`
// consumes the client-only `useLocale()` hook. Without its own `'use client'`
// directive Next treats the module as a Server Component and the RSC render
// throws ("Attempted to call useLocale() from the server but useLocale is on
// the client"), producing the server-side exception page. This test fails if
// the directive is ever dropped again.
const componentPath = fileURLToPath(new URL('./CalendarOptimalTimes.tsx', import.meta.url));
const pagePath = fileURLToPath(new URL('../app/models/[id]/calendar/page.tsx', import.meta.url));

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function hasUseClientDirective(source: string): boolean {
  // The directive must be the first statement (comments blank lines allowed).
  const withoutLeadingComments = source.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*/g, '');
  return /^\s*(['"])use client\1\s*;/.test(withoutLeadingComments);
}

describe('CalendarOptimalTimes client boundary (ops-hub #29)', () => {
  it('declares the use client directive because it calls the client-only useLocale hook', () => {
    const source = read(componentPath);
    expect(source).toMatch(/useLocale\(\)/);
    expect(hasUseClientDirective(source)).toBe(true);
  });

  it('is mounted from the server calendar page, which is not itself a client component', () => {
    const page = read(pagePath);
    expect(page).toMatch(/CalendarOptimalTimes/);
    // The page is a Server Component; the client boundary has to live on the child.
    expect(hasUseClientDirective(page)).toBe(false);
  });
});
