import { expect, it } from 'vitest';
import { parseWireGuardConfig } from './wireguard-import';
import { credentialPayload } from '../components/EgressCredentials';
const config = `[Interface]\nPrivateKey = ${'A'.repeat(43)}=\nAddress = 10.8.0.2/32\n[Peer]\nPublicKey = ${'B'.repeat(43)}=\nEndpoint = vpn.example:51820\nAllowedIPs = 0.0.0.0/0`;
it('carries provider keepalive from file to numeric API payload and resets omitted values', () => {
  for (const interval of [0, 25, 65535]) {
    const imported = parseWireGuardConfig(`${config}\nPersistentKeepalive = ${interval}`);
    const form = new FormData();
    Object.entries(imported).forEach(([name, value]) => form.set(name, value));
    expect(credentialPayload('wireguard', form)).toMatchObject({ wgPersistentKeepalive: interval });
  }
  expect(parseWireGuardConfig(config).wgPersistentKeepalive).toBe('0');
});
it.each(['-1', '65536', '2.5', 'NaN', ''])('rejects invalid keepalive %s', value => {
  expect(() => parseWireGuardConfig(`${config}\nPersistentKeepalive = ${value}`)).toThrow();
});
it.each(['constructor', 'toString', '__proto__'])('rejects inherited field names %s', name => {
  expect(() => parseWireGuardConfig(`${config}\n${name} = value`)).toThrow();
});
it('imports customer connection data including equals signs in keys', () => {
  expect(parseWireGuardConfig(config.replace(/\n/g, '\r\n'))).toMatchObject({ wgEndpoint: 'vpn.example:51820', wgInterfaceAddress: '10.8.0.2/32', wgPrivateKey: 'A'.repeat(43) + '=' });
});
it.each(['\nPostUp = echo secret', '\nDNS = 1.1.1.1', '\n[Peer]\nPublicKey = x', '\nEndpoint = second.example:443'])('rejects unsupported or ambiguous configuration without echoing it', suffix => {
  expect(() => parseWireGuardConfig(config + suffix)).toThrow();
  try { parseWireGuardConfig(config + suffix); } catch (error) { expect(String(error)).not.toContain('secret'); }
});
it.each([['10.8.0.2/32', '999.8.0.2/32'], ['51820', '99999'], ['0.0.0.0/0', '10.0.0.0/8']])('rejects invalid addressing or split tunnels', (before, after) => {
  expect(() => parseWireGuardConfig(config.replace(before, after))).toThrow();
});
