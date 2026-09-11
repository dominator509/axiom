import { afterEach, expect, it, vi } from 'vitest';
import config from './next.config';
import { resolveApiOrigin } from './lib/api-origin';

afterEach(() => vi.unstubAllEnvs());
it.each([['development', '.next-dev'], ['production', '.next']])(
  'isolates %s compilation output', async (mode, directory) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('API_ORIGIN', 'http://127.0.0.1:3001');
    vi.resetModules();
    const { default: configured } = await import('./next.config');
    expect(configured.distDir).toBe(directory);
  });

it('forwards the public Native page and click paths to the API', async () => {
  expect(await config.rewrites!()).toContainEqual({
    source: '/linkbio/:path*', destination: `${resolveApiOrigin()}/linkbio/:path*`,
  });
});
