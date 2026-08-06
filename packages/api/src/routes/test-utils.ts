// ─── Shared vitest mock for @axiom/db (chainable transaction proxy) ───
// Mirrors the egress.test.ts pattern: db.transaction calls the callback with
// a chainable tx whose awaited result is mockState.result. Each test controls
// what the CRUD query "returns" by setting mockState.result before the call.

import { vi } from 'vitest';

export const mockState: { result: unknown } = { result: [] };

export function makeChain(): any {
  const handler = {
    get(_t: unknown, prop: string | symbol) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          Promise.resolve(mockState.result).then(resolve, reject);
        };
      }
      return () => makeChain();
    },
    apply() {
      return makeChain();
    },
  };
  return new Proxy(function () {}, handler);
}

/** vi.mock factory for @axiom/db — call inside vi.mock('@axiom/db', factory). */
export function mockDbFactory(extraSchema: Record<string, unknown> = {}) {
  // Proxy schema: any table/column access returns {} — the chainable tx mock
  // never builds real SQL, but routes read schema.<table>.<column> eagerly.
  const schemaProxy = new Proxy(extraSchema, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return {};
    },
  });
  return {
    db: {
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
        const tx = makeChain();
        return cb(tx);
      }),
    },
    schema: schemaProxy,
  };
}
