import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refresh: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
import NetworkForm from './NetworkForm';

beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.refresh.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

function form() {
  hooks.index = 0;
  return NetworkForm({ modelId: 'model', initial: {
    egressMode: 'direct', proxyAddr: '127.0.0.1:1080', expectedEgressIp: '203.0.113.7',
  } });
}

it('sends explicit null when the operator clears saved network fields', async () => {
  form();
  hooks.values[1] = '';
  hooks.values[2] = '';
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await form().props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    egressMode: 'direct', proxyAddr: null, expectedEgressIp: null,
  });
  expect(hooks.refresh).toHaveBeenCalledOnce();
});

it('preserves nonempty edited values in the request', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await form().props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    egressMode: 'direct', proxyAddr: '127.0.0.1:1080', expectedEgressIp: '203.0.113.7',
  });
});
