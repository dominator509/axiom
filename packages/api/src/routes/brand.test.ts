import { describe, expect, it, vi } from 'vitest';
import { createBrandRouter } from './brand.js';

describe('public branding endpoint', () => {
  it('serves defaults anonymously with no-store', async () => {
    const response = await createBrandRouter({}).request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: { name: 'FanThynks', tagline: null } });
  });
  it('resolves at startup and returns only the public fields', async () => {
    const env = { AXIOM_BRAND_NAME: ' Studio ', AXIOM_BRAND_TAGLINE: ' Welcome ', DATABASE_URL: 'private-sentinel' };
    const router = createBrandRouter(env);
    env.AXIOM_BRAND_NAME = 'Changed after startup';
    const response = await router.request('/');
    expect(await response.json()).toEqual({ data: { name: 'Studio', tagline: 'Welcome' } });
  });
  it('logs field names only and uses independent safe fallbacks', async () => {
    const warn = vi.fn();
    const router = createBrandRouter({ AXIOM_BRAND_NAME: 'private\ninvalid', AXIOM_BRAND_TAGLINE: 'Good' }, warn);
    expect(await (await router.request('/')).json()).toEqual({ data: { name: 'FanThynks', tagline: 'Good' } });
    expect(warn.mock.calls).toEqual([['Invalid branding field: AXIOM_BRAND_NAME']]);
  });
  it('exposes no write operation', async () => {
    expect((await createBrandRouter({}).request('/', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
