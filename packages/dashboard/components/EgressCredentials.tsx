'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { NETWORK_CHILD_CONTROLS_CATALOGS } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { parseWireGuardConfig } from '@/lib/wireguard-import';
import { useLocale } from './LocaleProvider';

type Translator = (key: string, values?: Record<string, string | number>) => string;

function englishText(key: string, values?: Record<string, string | number>): string {
  const template = NETWORK_CHILD_CONTROLS_CATALOGS.en[key] ?? key;
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function credentialPayload(mode: string, fields: FormData, t: Translator = englishText) {
  const value = (key: string) => String(fields.get(key) ?? '').trim();
  if (mode === 'wireguard' || mode === 'vpn') {
    const wgPrivateKey = value('wgPrivateKey'),
      wgPublicKey = value('wgPublicKey');
    const wgPresharedKey = value('wgPresharedKey'),
      wgEndpoint = value('wgEndpoint'),
      wgInterfaceAddress = value('wgInterfaceAddress');
    const key = /^[A-Za-z0-9+/]{43}=$/;
    if (
      !key.test(wgPrivateKey) ||
      !key.test(wgPublicKey) ||
      (wgPresharedKey && !key.test(wgPresharedKey))
    )
      throw new Error(t('egress.errorInvalidKeys'));
    if (!wgEndpoint || wgEndpoint.length > 500 || !wgInterfaceAddress)
      throw new Error(t('egress.errorTunnelAddress'));
    const keepalive = value('wgPersistentKeepalive') || '0';
    if (!/^\d{1,5}$/.test(keepalive) || Number(keepalive) > 65535)
      throw new Error(t('egress.errorKeepalive'));
    return {
      wgPrivateKey,
      wgPublicKey,
      wgEndpoint,
      wgInterfaceAddress,
      wgPersistentKeepalive: Number(keepalive),
      wgAllowedIps: value('wgAllowedIps') || '0.0.0.0/0',
      ...(wgPresharedKey ? { wgPresharedKey } : {}),
    };
  }
  if (!['socks5', 'http', 'https'].includes(mode)) throw new Error(t('egress.errorMode'));
  // Passwords are opaque: preserve leading/trailing spaces.
  const proxyUsername = String(fields.get('proxyUsername') ?? ''),
    proxyPassword = String(fields.get('proxyPassword') ?? '');
  if (!proxyUsername || !proxyPassword || proxyUsername.length > 500 || proxyPassword.length > 500)
    throw new Error(t('egress.errorProxyCredentials'));
  return { proxyUsername, proxyPassword };
}

export default function EgressCredentials({
  configId,
  mode,
  wgPublicKey,
  wgEndpoint,
  wgAllowedIps,
  wgPersistentKeepalive,
}: {
  configId: string;
  mode: string;
  wgPublicKey?: string | null;
  wgEndpoint?: string | null;
  wgAllowedIps?: string | null;
  wgPersistentKeepalive?: number | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const active = useRef(false),
    intent = useRef<{ body: string; key: string } | null>(null);
  const tunnel = mode === 'wireguard' || mode === 'vpn';

  async function importConfig(input: HTMLInputElement) {
    const file = input.files?.[0];
    const form = input.form;
    if (!file || !form) return;
    setError('');
    setMessage('');
    try {
      if (file.size > 16_384) throw new Error(t('egress.errorConfigSize'));
      const fields = parseWireGuardConfig(await file.text());
      if (active.current || intent.current) return;
      for (const [name, value] of Object.entries(fields)) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement) field.value = value;
      }
      const optional = form.elements.namedItem('wgPresharedKey');
      if (optional instanceof HTMLInputElement) optional.value = fields.wgPresharedKey ?? '';
      setMessage(t('egress.imported'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('egress.errorReadConfig'));
    } finally {
      input.value = '';
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError('');
    setMessage('');
    try {
      if (!intent.current)
        intent.current = {
          body: JSON.stringify(credentialPayload(mode, new FormData(form), t)),
          key: createIdempotencyKey(),
        };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('egress.errorFields'));
      return;
    }
    active.current = true;
    setBusy(true);
    setPending(true);
    try {
      const response = await mutationFetch(
        `/api/v1/egress/${encodeURIComponent(configId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: intent.current.body,
        },
        { idempotencyKey: intent.current.key },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        // Never display a provider error body that might echo secret material.
        setError(t('egress.saveHttp', { status: response.status }));
        return;
      }
      intent.current = null;
      setPending(false);
      form.reset();
      setMessage(t('egress.saved'));
      router.refresh();
    } catch {
      setError(t('egress.saveUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="card stack"
      autoComplete="off"
      aria-label={
        tunnel ? t('egress.credentialsTitleWireGuard') : t('egress.credentialsTitleProxy')
      }
    >
      <h3>{tunnel ? t('egress.credentialsTitleWireGuard') : t('egress.credentialsTitleProxy')}</h3>
      <p>{t('egress.credentialsDescription')}</p>
      {tunnel && <p>{t('egress.wireguardProtocol')}</p>}
      <fieldset
        disabled={busy || pending}
        className="stack"
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        {tunnel ? (
          <>
            <p>{t('egress.providerHelp')}</p>
            <label>
              {t('egress.importConfig')}
              <input
                type="file"
                accept=".conf,text/plain"
                onChange={(event) => {
                  void importConfig(event.currentTarget);
                }}
              />
            </label>
            <label>
              {t('egress.privateKey')}
              <input
                type="password"
                name="wgPrivateKey"
                required
                autoComplete="new-password"
                maxLength={44}
              />
            </label>
            <label>
              {t('egress.publicKey')}
              <input
                name="wgPublicKey"
                defaultValue={wgPublicKey ?? ''}
                required
                maxLength={44}
                spellCheck={false}
              />
            </label>
            <label>
              {t('egress.presharedKey')}
              <input
                type="password"
                name="wgPresharedKey"
                autoComplete="new-password"
                maxLength={44}
              />
            </label>
            <label>
              {t('egress.endpoint')}
              <input
                name="wgEndpoint"
                defaultValue={wgEndpoint ?? ''}
                required
                maxLength={500}
                spellCheck={false}
              />
            </label>
            <label>
              {t('egress.interfaceAddress')}
              <input
                name="wgInterfaceAddress"
                required
                placeholder="10.88.0.9/32"
                maxLength={49}
                spellCheck={false}
              />
            </label>
            <label>
              {t('egress.allowedIps')}
              <input
                name="wgAllowedIps"
                defaultValue={wgAllowedIps ?? '0.0.0.0/0'}
                maxLength={1000}
                required
                spellCheck={false}
              />
            </label>
            <label>
              {t('egress.keepalive')}
              <input
                type="number"
                name="wgPersistentKeepalive"
                defaultValue={wgPersistentKeepalive ?? 0}
                min={0}
                max={65535}
                step={1}
                required
              />
            </label>
            <p className="subtle">{t('egress.keepaliveHelp')}</p>
          </>
        ) : (
          <>
            <label>
              {t('egress.proxyUsername')}
              <input
                name="proxyUsername"
                required
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              {t('egress.proxyPassword')}
              <input
                type="password"
                name="proxyPassword"
                required
                maxLength={500}
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        <label className="checkbox-option">
          <input type="checkbox" required /> {t('egress.replaceAcknowledgement')}
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button disabled={busy} type="submit">
        {busy ? t('egress.saving') : pending ? t('egress.retry') : t('egress.save')}
      </button>
    </form>
  );
}
