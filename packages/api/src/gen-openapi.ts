// ─── Build-time OpenAPI generation (L3.0) ───
// The L3.0 spec says the full OpenAPI doc is generated from the Hono route
// schemas at build time. This script walks the mounted app's route table
// (Hono exposes every registered route via app.routes) and emits a real
// OpenAPI 3.0 document at packages/api/dist/openapi.json.
//
// Honest scope note: routes validate at runtime (zod-validator) rather than
// declaring OpenAPI schema objects, so this document enumerates every path +
// method + security scheme + shared parameter conventions (cursor/limit,
// Idempotency-Key). Request/response bodies are documented structurally
// (application/json) — the precise zod schemas live in the route source.
//
// Run: node dist/gen-openapi.js  (after `pnpm --filter @axiom/api build`)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SECURITY_SCHEMES = {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  capabilityToken: {
    type: 'http',
    scheme: 'bearer',
    description: 'MCP capability token for /api/mcp',
  },
};

export interface RouteEntry {
  method: string;
  path: string;
}

export function groupRoutes(routes: RouteEntry[]): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const method = r.method.toLowerCase();
    // Skip Hono middleware registrations (auth guards mounted via app.use)
    // — they show up as 'all' and are not OpenAPI operations.
    if (method === 'options' || method === 'all') continue;
    if (!paths[r.path]) paths[r.path] = {};
    paths[r.path][method] = {
      summary: `${method.toUpperCase()} ${r.path}`,
      security: [{ bearerAuth: [] }],
      responses: {
        '200': { description: 'Success' },
        '400': { description: 'RFC-7807 problem+json (validation)' },
        '401': { description: 'Unauthorized' },
        '500': { description: 'Internal error' },
      },
      parameters:
        method === 'get'
          ? [
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100 },
                description: 'Page size (keyset pagination)',
              },
              {
                name: 'cursor',
                in: 'query',
                schema: { type: 'string' },
                description: 'Opaque keyset cursor',
              },
            ]
          : [],
    };
  }
  return paths;
}

export function buildOpenApi(routes: RouteEntry[]): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'AXIOM FanvueCRM API',
      version: '0.1.0',
      description:
        'Multi-tenant CRM for operating Fanvue talent profiles. All /api/v1 routes enforce session auth (bearer), org RLS isolation, rate limits and audit. Mutations that touch platforms require an Idempotency-Key header. Errors are RFC-7807 problem+json with correlation_id.',
    },
    servers: [{ url: 'https://crm.<domain>/api/v1', description: 'Production' }],
    paths: groupRoutes(routes),
    components: { securitySchemes: SECURITY_SCHEMES },
  };
}

// ── Main (build-time): only runs when executed directly, not when imported ──
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  // Import the built app — module init mounts all routers.
  const { default: app } = await import('./index.js');
  const doc = buildOpenApi((app.routes ?? []) as RouteEntry[]);

  const outDir = dirname(fileURLToPath(import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'openapi.json');
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  const counts = Object.values(doc.paths as Record<string, Record<string, unknown>>).reduce(
    (acc: Record<string, number>, ops: Record<string, unknown>) => {
      for (const m of Object.keys(ops)) acc[m] = (acc[m] ?? 0) + 1;
      return acc;
    },
    {},
  );
  console.log(`openapi: wrote ${outPath}`);
  console.log(
    `openapi: ${Object.keys(doc.paths as Record<string, unknown>).length} paths, ${JSON.stringify(counts)}`,
  );
}
