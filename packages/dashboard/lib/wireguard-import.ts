/** Parse data only: never execute wg-quick hooks or silently discard routing settings. */
export function parseWireGuardConfig(text: string): Record<string, string> {
  if (text.length > 16_384) throw new Error('WireGuard configuration must be smaller than 16 KB.');
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  let section = '';
  const mapping: Record<string, Record<string, string>> = {
    Interface: { PrivateKey: 'wgPrivateKey', Address: 'wgInterfaceAddress' },
    Peer: { PublicKey: 'wgPublicKey', PresharedKey: 'wgPresharedKey', Endpoint: 'wgEndpoint', AllowedIPs: 'wgAllowedIps', PersistentKeepalive: 'wgPersistentKeepalive' },
  };
  for (const original of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = original.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      if (line !== '[Interface]' && line !== '[Peer]') throw new Error('Only Interface and Peer sections are supported.');
      section = line.slice(1, -1);
      if (seen.has(section)) throw new Error('Import one Interface and one Peer per talent.');
      seen.add(section);
      continue;
    }
    const separator = line.indexOf('=');
    if (!section || separator < 1) throw new Error('Invalid WireGuard configuration format.');
    const name = line.slice(0, separator).trim();
    const target = Object.hasOwn(mapping[section], name) ? mapping[section][name] : undefined;
    if (!target) throw new Error('This configuration contains unsupported settings. Supported settings are keys, Address, Endpoint, AllowedIPs and PersistentKeepalive. Additional DNS, routing or hook settings require support before import.');
    if (Object.hasOwn(fields, target)) throw new Error('Duplicate WireGuard setting.');
    fields[target] = line.slice(separator + 1).trim();
  }
  const key = /^[A-Za-z0-9+/]{43}=$/;
  if (!key.test(fields.wgPrivateKey ?? '') || !key.test(fields.wgPublicKey ?? '') || (fields.wgPresharedKey && !key.test(fields.wgPresharedKey))) throw new Error('The configuration must contain valid WireGuard keys.');
  const address = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(fields.wgInterfaceAddress ?? '');
  if (!address || address[1].split('.').some(part => Number(part) > 255) || Number(address[2]) > 32) throw new Error('The current connection supports one IPv4 tunnel address in CIDR format.');
  const endpoint = /^([^\s:/]+):(\d{1,5})$/.exec(fields.wgEndpoint ?? '');
  if (!endpoint || Number(endpoint[2]) < 1 || Number(endpoint[2]) > 65535) throw new Error('Enter an IPv4 or hostname endpoint with a valid port.');
  if (fields.wgAllowedIps !== '0.0.0.0/0') throw new Error('Use a full-tunnel IPv4 configuration with AllowedIPs = 0.0.0.0/0.');
  const keepalive = fields.wgPersistentKeepalive;
  if (keepalive !== undefined && (!/^\d{1,5}$/.test(keepalive) || Number(keepalive) > 65535)) throw new Error('PersistentKeepalive must be between 0 and 65535 seconds.');
  fields.wgPersistentKeepalive = keepalive ?? '0';
  return fields;
}
