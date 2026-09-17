'use client';
import { useRef, useState } from 'react';

const route = '/api/v1/llm/subscriptions/grok/r2-storage';
export default function GrokR2Storage() {
  const [status, setStatus] = useState('Storage not checked');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function request(method: 'GET' | 'PUT' | 'DELETE' | 'POST', body?: Record<string, string>) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(method === 'POST' ? `${route}/verify` : route, { method, credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error('Storage request failed');
      const data = await response.json();
      if (typeof data.configured !== 'boolean') throw new Error('Invalid response');
      setStatus(data.verified ? 'R2 bucket read/write verified; the temporary probe object was removed.'
        : data.configured ? 'R2 configuration saved. Bucket access and video generation have not been verified.'
        : 'No R2 configuration saved for this workspace and operator.');
    } catch {
      setStatus('Storage operation not confirmed. Check saved status before trying again.');
    } finally { clearTimeout(timeout); pending.current = false; setBusy(false); }
  }
  return <section className="stack" aria-label="Grok video storage">
    <h2>Private R2 video storage</h2>
    <p>Keep Grok ZDR enabled. Enter bucket-scoped R2 S3 credentials here, never in chat. Saving does not generate media or change bucket permissions.</p>
    <form className="stack" autoComplete="off" onSubmit={event => {
      event.preventDefault();
      if (pending.current) return;
      const form = event.currentTarget;
      const fields = new FormData(form);
      const body = Object.fromEntries(['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'].map(key => [key, String(fields.get(key) ?? '')]));
      form.reset(); // Never retain secrets for a transport retry or browser storage.
      void request('PUT', body);
    }}>
      <label>S3 endpoint<input name="endpoint" type="url" required disabled={busy} autoCapitalize="none" spellCheck={false} placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com" /></label>
      <label>Bucket<input name="bucket" required minLength={3} maxLength={63} defaultValue="axiom-grok-media" disabled={busy} autoCapitalize="none" spellCheck={false} /></label>
      <label>Access key ID<input name="accessKeyId" type="password" required minLength={32} maxLength={32} disabled={busy} autoComplete="new-password" /></label>
      <label>Secret access key<input name="secretAccessKey" type="password" required minLength={64} maxLength={64} disabled={busy} autoComplete="new-password" /></label>
      <label><input type="checkbox" required disabled={busy} /> These credentials are restricted to Object Read &amp; Write for this private bucket.</label>
      <button type="submit" disabled={busy}>Save R2 credentials</button>
    </form>
    <div><button disabled={busy} onClick={() => void request('GET')}>Check saved status</button>{' '}
      <button disabled={busy} onClick={() => void request('POST')}>Verify bucket access</button>{' '}
      <button disabled={busy} onClick={() => void request('DELETE')}>Remove saved R2 credentials</button></div>
    <p role="status">{status}</p>
    <p>Removal prevents future requests from loading these credentials. It does not revoke the Cloudflare keys, delete stored media, or cancel a running generation.</p>
  </section>;
}
