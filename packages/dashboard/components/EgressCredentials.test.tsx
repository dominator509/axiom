import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EgressCredentials, { credentialPayload } from './EgressCredentials';
import LocaleProvider from './LocaleProvider';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function fields(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
it('preserves opaque proxy passwords exactly', () => {
  expect(
    credentialPayload('socks5', fields({ proxyUsername: 'user', proxyPassword: ' space ' })),
  ).toEqual({ proxyUsername: 'user', proxyPassword: ' space ' });
});
it('requires complete proxy credentials and rejects direct mode', () => {
  expect(() => credentialPayload('https', fields({ proxyUsername: 'user' }))).toThrow();
  expect(() => credentialPayload('direct', fields({}))).toThrow();
});
it('includes provider tunnel address with the full credential set', () => {
  const key = 'A'.repeat(43) + '=';
  expect(
    credentialPayload(
      'wireguard',
      fields({
        wgPrivateKey: key,
        wgPublicKey: key,
        wgEndpoint: 'vpn.example:51820',
        wgInterfaceAddress: '10.88.0.9/32',
      }),
    ),
  ).toMatchObject({
    wgInterfaceAddress: '10.88.0.9/32',
    wgAllowedIps: '0.0.0.0/0',
    wgPrivateKey: key,
  });
});
it('renders secret inputs without existing secrets and requires replacement acknowledgment', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <EgressCredentials configId="config" mode="wireguard" />
    </LocaleProvider>,
  );
  expect(html).toContain('type="password"');
  expect(html).toContain('type="checkbox" required=""');
  expect(html).toContain('existing secrets are never displayed');
});

it('prefills saved public WireGuard settings while leaving secret inputs blank', () => {
  const privateKey = 'A'.repeat(43) + '=';
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <EgressCredentials
        configId="config"
        mode="wireguard"
        wgPublicKey="public-key-value"
        wgEndpoint="vpn.example:51820"
        wgAllowedIps="10.0.0.0/8"
        wgPersistentKeepalive={25}
      />
    </LocaleProvider>,
  );
  expect(html).toContain('value="public-key-value"');
  expect(html).toContain('value="vpn.example:51820"');
  expect(html).toContain('value="10.0.0.0/8"');
  expect(html).toContain('value="25"');
  expect(html).not.toContain(privateKey);
});
