'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';

export function credentialPayload(mode: string, fields: FormData) {
  const value = (key: string) => String(fields.get(key) ?? '').trim();
  if (mode === 'wireguard' || mode === 'vpn') {
    const wgPrivateKey = value('wgPrivateKey'), wgPublicKey = value('wgPublicKey');
    const wgPresharedKey = value('wgPresharedKey'), wgEndpoint = value('wgEndpoint'), wgInterfaceAddress = value('wgInterfaceAddress');
    const key = /^[A-Za-z0-9+/]{43}=$/;
    if (!key.test(wgPrivateKey) || !key.test(wgPublicKey) || (wgPresharedKey && !key.test(wgPresharedKey))) throw new Error('Enter valid WireGuard keys.');
    if (!wgEndpoint || wgEndpoint.length > 500 || !wgInterfaceAddress) throw new Error('Enter the peer endpoint and assigned tunnel address.');
    return { wgPrivateKey, wgPublicKey, wgEndpoint, wgInterfaceAddress,
      wgAllowedIps: value('wgAllowedIps') || '0.0.0.0/0', ...(wgPresharedKey ? { wgPresharedKey } : {}) };
  }
  if (!['socks5', 'http', 'https'].includes(mode)) throw new Error('Select and save a proxy or WireGuard mode first.');
  // Passwords are opaque: preserve leading/trailing spaces.
  const proxyUsername = String(fields.get('proxyUsername') ?? ''), proxyPassword = String(fields.get('proxyPassword') ?? '');
  if (!proxyUsername || !proxyPassword || proxyUsername.length > 500 || proxyPassword.length > 500) throw new Error('Enter both proxy credentials (up to 500 characters each).');
  return { proxyUsername, proxyPassword };
}

export default function EgressCredentials({ configId, mode }: { configId: string; mode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const active = useRef(false), intent = useRef<{ body: string; key: string } | null>(null);
  const tunnel = mode === 'wireguard' || mode === 'vpn';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError(''); setMessage('');
    try {
      if (!intent.current) intent.current = { body: JSON.stringify(credentialPayload(mode, new FormData(form))), key: createIdempotencyKey() };
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the credential fields.'); return; }
    active.current = true; setBusy(true); setPending(true);
    try {
      const response = await mutationFetch(`/api/v1/egress/${encodeURIComponent(configId)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        if ([400, 401, 403, 404, 422].includes(response.status)) { intent.current = null; setPending(false); }
        // Never display a provider error body that might echo secret material.
        setError(`Credential save not confirmed (HTTP ${response.status}). Check your permissions and fields, or retry the same save.`); return;
      }
      intent.current = null; setPending(false); form.reset();
      setMessage('Credentials saved encrypted. This does not confirm activation or a healthy protected connection.'); router.refresh();
    } catch { setError('Save not confirmed. Retry the same save; do not enter another credential set yet.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="card stack" autoComplete="off" aria-label="Encrypted egress credentials">
    <h3>{tunnel ? 'WireGuard connection credentials' : 'Authenticated proxy credentials'}</h3>
    <p>This replaces the complete saved credential set. Re-enter all required secrets; existing secrets are never displayed. Only submit over HTTPS.</p>
    {tunnel && <p>The VPN mode uses WireGuard, not an OpenVPN configuration. Enter the address supplied by your VPN provider.</p>}
    <fieldset disabled={busy || pending} className="stack" style={{ border: 0, padding: 0, minWidth: 0 }}>
      {tunnel ? <>
        <label>Private key<input type="password" name="wgPrivateKey" required autoComplete="new-password" maxLength={44} /></label>
        <label>Peer public key<input name="wgPublicKey" required maxLength={44} spellCheck={false} /></label>
        <label>Preshared key (optional)<input type="password" name="wgPresharedKey" autoComplete="new-password" maxLength={44} /></label>
        <label>Peer endpoint (host:port)<input name="wgEndpoint" required maxLength={500} spellCheck={false} /></label>
        <label>Assigned IPv4 tunnel address (CIDR)<input name="wgInterfaceAddress" required placeholder="10.88.0.9/32" maxLength={49} spellCheck={false} /></label>
        <label>Allowed IP ranges<input name="wgAllowedIps" defaultValue="0.0.0.0/0" maxLength={1000} required spellCheck={false} /></label>
      </> : <>
        <label>Proxy username<input name="proxyUsername" required maxLength={500} autoComplete="off" spellCheck={false} /></label>
        <label>Proxy password<input type="password" name="proxyPassword" required maxLength={500} autoComplete="new-password" /></label>
      </>}
      <label className="checkbox-option"><input type="checkbox" required /> Replace this talent’s saved credentials with the complete set above.</label>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button disabled={busy} type="submit">{busy ? 'Saving…' : pending ? 'Retry same credential save' : 'Save encrypted credentials'}</button>
  </form>;
}
