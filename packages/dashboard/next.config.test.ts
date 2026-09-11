import { expect, it } from 'vitest';
import config from './next.config';
import { resolveApiOrigin } from './lib/api-origin';

it('forwards the public Native page and click paths to the API', async () => {
  expect(await config.rewrites!()).toContainEqual({
    source: '/linkbio/:path*', destination: `${resolveApiOrigin()}/linkbio/:path*`,
  });
});
