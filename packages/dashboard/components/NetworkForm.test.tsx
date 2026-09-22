import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refresh: vi.fn() }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value;
      },
    ];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    t: (key: string) =>
      key === 'network.chooseConnection' ? 'Choose an outbound connection before saving.' : key,
  }),
}));
import NetworkForm from './NetworkForm';

beforeEach(() => {
  hooks.values = [];
  hooks.index = 0;
  hooks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('does not submit an unconfigured model as direct', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const element = NetworkForm({ modelId: 'model', initial: null });
  expect(hooks.values[0]).toBe('');
  await element.props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(fetch).not.toHaveBeenCalled();
  expect(hooks.values[5]).toBe('Choose an outbound connection before saving.');
});

function form(mode = 'socks5') {
  hooks.index = 0;
  return NetworkForm({
    modelId: 'model',
    initial: {
      egressMode: mode,
      proxyAddr: '127.0.0.1:1080',
      expectedEgressIp: '203.0.113.7',
      failoverProxyAddrs: ['192.0.2.10:1080', '192.0.2.11:1080'],
    },
  });
}

function containsId(node: unknown, id: string): boolean {
  if (Array.isArray(node)) return node.some((child) => containsId(child, id));
  if (!node || typeof node !== 'object') return false;
  const element = node as { props?: { id?: string; children?: unknown } };
  return element.props?.id === id || containsId(element.props?.children, id);
}

it('sends explicit null when the operator clears saved network fields', async () => {
  form();
  hooks.values[1] = '';
  hooks.values[2] = '';
  hooks.values[3] = '';
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await form().props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    egressMode: 'socks5',
    proxyType: 'socks5',
    proxyAddr: null,
    expectedEgressIp: null,
    failoverProxyAddrs: [],
  });
  expect(hooks.refresh).toHaveBeenCalledOnce();
});

it('preserves nonempty edited values in the request', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await form().props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    egressMode: 'socks5',
    proxyType: 'socks5',
    proxyAddr: '127.0.0.1:1080',
    expectedEgressIp: '203.0.113.7',
    failoverProxyAddrs: ['192.0.2.10:1080', '192.0.2.11:1080'],
  });
});

it('trims blank lines from the ordered failover list', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  form();
  hooks.values[3] = ' 192.0.2.10:1080 \n\n 192.0.2.11:1080 ';
  await form().props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(JSON.parse(fetch.mock.calls[0][1].body).failoverProxyAddrs).toEqual([
    '192.0.2.10:1080',
    '192.0.2.11:1080',
  ]);
});

it('shows proxy-only fields for proxy modes and omits them for direct mode', () => {
  hooks.values = [];
  expect(containsId(form('direct'), 'proxyAddr')).toBe(false);
  expect(containsId(form('direct'), 'failoverProxyAddrs')).toBe(false);

  hooks.values = [];
  expect(containsId(form('socks5'), 'proxyAddr')).toBe(true);
  expect(containsId(form('socks5'), 'failoverProxyAddrs')).toBe(true);
});

it('clears proxy-only settings when switching to WireGuard', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  form('direct');
  hooks.values[0] = 'wireguard';
  hooks.values[3] = ' 192.0.2.10:1080 \n\n 192.0.2.11:1080 ';
  await form('wireguard').props.onSubmit({ preventDefault() {} } as FormEvent);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    egressMode: 'wireguard',
    proxyType: null,
    proxyAddr: null,
    expectedEgressIp: '203.0.113.7',
    failoverProxyAddrs: [],
  });
});
