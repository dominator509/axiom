// ─── Kill Switch Router — Vitest Suite ───
// Covers: status read, enable (with/without reason, malformed body), disable.
// NOTE: the router holds in-memory module state, so these tests run sequentially
// against the same instance — order below is intentional.

import { describe, it, expect, beforeAll } from 'vitest';

let router: any;

beforeAll(async () => {
  const mod = await import('./killswitch.js');
  router = mod.killswitchRouter;
});

describe('GET /killswitch — initial state', () => {
  it('reports the kill switch disabled with no reason', async () => {
    const res = await router.request('/killswitch');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    expect(body.data.reason).toBe('');
    expect(body.data.startedAt).toBeNull();
    expect(body.data.updatedAt).toBeNull();
  });
});

describe('POST /killswitch/enable', () => {
  it('enables with a custom reason and timestamps', async () => {
    const res = await router.request('/killswitch/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'db on fire' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
    expect(body.data.reason).toBe('db on fire');
    expect(new Date(body.data.startedAt).toISOString()).toBe(body.data.startedAt);
    expect(new Date(body.data.updatedAt).toISOString()).toBe(body.data.updatedAt);
  });

  it('falls back to the default reason when none is provided', async () => {
    const res = await router.request('/killswitch/enable', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
    expect(body.data.reason).toBe('Emergency shutdown triggered');
  });

  it('tolerates a malformed JSON body', async () => {
    const res = await router.request('/killswitch/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{{{',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
    expect(body.data.reason).toBe('Emergency shutdown triggered');
  });

  it('tolerates a non-object body (e.g. array)', async () => {
    const res = await router.request('/killswitch/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['not', 'an', 'object']),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
  });
});

describe('POST /killswitch/disable', () => {
  it('disables and clears the reason, refreshing updatedAt', async () => {
    const res = await router.request('/killswitch/disable', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    expect(body.data.reason).toBe('');
    expect(new Date(body.data.updatedAt).toISOString()).toBe(body.data.updatedAt);
  });

  it('status endpoint reflects the disabled state afterwards', async () => {
    const res = await router.request('/killswitch');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    expect(body.data.reason).toBe('');
  });

  it('re-enable after disable works (toggle cycle)', async () => {
    await router.request('/killswitch/enable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'cycle' }),
    });
    const res = await router.request('/killswitch');
    expect((await res.json()).data.enabled).toBe(true);
    // leave the switch off for any downstream consumers
    await router.request('/killswitch/disable', { method: 'POST' });
  });
});
