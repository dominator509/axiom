'use client';
import { useRef, useState } from 'react';
import { useLocale } from './LocaleProvider';

const route = '/api/v1/llm/subscriptions/grok/r2-storage';
export default function GrokR2Storage() {
  const { t } = useLocale();
  const [status, setStatus] = useState(() => t('dashboard.r2.statusNotChecked'));
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
      setStatus(data.verified ? t('dashboard.r2.verified')
        : data.configured ? t('dashboard.r2.saved')
        : t('dashboard.r2.notConfigured'));
    } catch {
      setStatus(t('dashboard.r2.operationFailed'));
    } finally { clearTimeout(timeout); pending.current = false; setBusy(false); }
  }
  return <section className="stack" aria-label={t('dashboard.r2.title')}>
    <h2>{t('dashboard.r2.title')}</h2>
    <p>{t('dashboard.r2.description')}</p>
    <form className="stack" autoComplete="off" onSubmit={event => {
      event.preventDefault();
      if (pending.current) return;
      const form = event.currentTarget;
      const fields = new FormData(form);
      const body = Object.fromEntries(['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'].map(key => [key, String(fields.get(key) ?? '')]));
      form.reset(); // Never retain secrets for a transport retry or browser storage.
      void request('PUT', body);
    }}>
      <label>{t('dashboard.r2.endpoint')}<input name="endpoint" type="url" required disabled={busy} autoCapitalize="none" spellCheck={false} placeholder={t('dashboard.r2.endpointPlaceholder')} /></label>
      <label>{t('dashboard.r2.bucket')}<input name="bucket" required minLength={3} maxLength={63} defaultValue="axiom-grok-media" disabled={busy} autoCapitalize="none" spellCheck={false} /></label>
      <label>{t('dashboard.r2.accessKey')}<input name="accessKeyId" type="password" required minLength={32} maxLength={32} disabled={busy} autoComplete="new-password" /></label>
      <label>{t('dashboard.r2.secretKey')}<input name="secretAccessKey" type="password" required minLength={64} maxLength={64} disabled={busy} autoComplete="new-password" /></label>
      <label><input type="checkbox" required disabled={busy} /> {t('dashboard.r2.restriction')}</label>
      <button type="submit" disabled={busy}>{t('dashboard.r2.save')}</button>
    </form>
    <div><button disabled={busy} onClick={() => void request('GET')}>{t('dashboard.r2.checkStatus')}</button>{' '}
      <button disabled={busy} onClick={() => void request('POST')}>{t('dashboard.r2.verify')}</button>{' '}
      <button disabled={busy} onClick={() => void request('DELETE')}>{t('dashboard.r2.remove')}</button></div>
    <p role="status">{status}</p>
    <p>{t('dashboard.r2.removalNote')}</p>
  </section>;
}
