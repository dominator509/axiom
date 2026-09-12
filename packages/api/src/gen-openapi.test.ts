// ─── OpenAPI generation (L3.0) — Vitest Suite ───
// Verifies the build-time generator's pure functions: standard methods only,
// no middleware 'all' entries, security schemes + pagination params present.

import { describe, it, expect } from 'vitest';
import { groupRoutes, buildOpenApi } from './gen-openapi.js';

describe('groupRoutes (L3.0 build-time OpenAPI)', () => {
  it('keeps standard methods, drops middleware ALL + OPTIONS', () => {
    const paths = groupRoutes([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/a' },
      { method: 'ALL', path: '/guard' },
      { method: 'OPTIONS', path: '/a' },
    ]);
    expect(Object.keys(paths)).toEqual(['/a']);
    expect(Object.keys(paths['/a']).sort()).toEqual(['get', 'post']);
  });

  it('attaches bearer security and cursor/limit params on GET', () => {
    const paths = groupRoutes([{ method: 'GET', path: '/list' }]);
    const op = paths['/list']['get'] as Record<string, unknown>;
    expect(op['security']).toEqual([{ bearerAuth: [] }]);
    const params = op['parameters'] as Array<{ name: string }>;
    expect(params.map((p) => p.name)).toEqual(['limit', 'cursor']);
  });

  it('does not attach pagination params on non-GET operations', () => {
    const paths = groupRoutes([{ method: 'POST', path: '/create' }]);
    const op = paths['/create']['post'] as Record<string, unknown>;
    expect(op['parameters']).toEqual([]);
  });

  it('converts mounted route parameters to required OpenAPI path parameters', () => {
    const paths = groupRoutes([
      { method: 'POST', path: '/api/v1/models/:modelId/bundles/:id/approve' },
    ]);
    const operation = paths['/api/v1/models/{modelId}/bundles/{id}/approve'].post as Record<
      string,
      unknown
    >;
    expect(operation.parameters).toEqual(
      ['modelId', 'id'].map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
    );
    expect(Object.keys(paths).some((path) => path.includes(':'))).toBe(false);
  });

  it('omits wildcard forwarding mounts rather than advertising literal star endpoints', () => {
    expect(groupRoutes([{ method: 'GET', path: '/api/auth/*' }])).toEqual({});
  });

  it('resolves full mounted paths without repeating the API prefix', () => {
    const doc = buildOpenApi([{ method: 'GET', path: '/api/v1/health' }]);
    const servers = doc.servers as { url: string }[];
    expect(servers[0].url).toBe('/');
    const origin = new URL(servers[0].url, 'https://operator.example/api/v1/openapi.json');
    const target = new URL('/api/v1/health', origin);
    expect(target.href).toBe('https://operator.example/api/v1/health');
  });

  it('buildOpenApi emits a valid OpenAPI 3.0 envelope', () => {
    const doc = buildOpenApi([
      { method: 'GET', path: '/api/v1/health' },
      { method: 'POST', path: '/api/v1/models/:modelId/generate' },
    ]);
    expect(doc.openapi).toBe('3.0.3');
    expect((doc.info as Record<string, unknown>).title).toBe('AXIOM FanvueCRM API');
    const paths = doc.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toHaveLength(2);
    const schemes = (doc.components as Record<string, unknown>).securitySchemes as Record<
      string,
      unknown
    >;
    expect(Object.keys(schemes).sort()).toEqual(['bearerAuth', 'capabilityToken']);
  });
});
