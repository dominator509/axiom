import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the ops-hub #29 approvals crash (AXIOM #36, digest
// 1270550845). CaptionGuidance keeps server-side sha256 receipt verification
// (node:crypto) and must therefore remain a Server Component: it must not call
// the client-only useLocale() hook. It receives locale/translator props from
// the approvals page instead. If someone reintroduces useLocale() here, the RSC
// render throws again and the approvals page dies with a server exception.
const componentPath = fileURLToPath(new URL('./CaptionGuidance.tsx', import.meta.url));
const pagePath = fileURLToPath(new URL('../app/models/[id]/approvals/page.tsx', import.meta.url));

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function hasUseClientDirective(source: string): boolean {
  const withoutLeadingComments = source.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*/g, '');
  return /^\s*(['"])use client\1\s*;/.test(withoutLeadingComments);
}

describe('CaptionGuidance server boundary (ops-hub #29)', () => {
  it('stays a server component and does not consume the client useLocale hook', () => {
    const source = read(componentPath);
    expect(source).toMatch(/node:crypto/);
    expect(source).not.toMatch(/useLocale\s*\(/);
    expect(hasUseClientDirective(source)).toBe(false);
  });

  it('receives locale and translator props from the server approvals page', () => {
    const page = read(pagePath);
    expect(page).toMatch(/<CaptionGuidance[^>]*locale=\{locale\}[^>]*t=\{t\}/);
  });
});
