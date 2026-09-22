'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const MODES = ['direct', 'socks5', 'http', 'https', 'wireguard', 'vpn'] as const;
const MODE_LABEL_KEYS = {
  direct: 'network.mode.direct',
  socks5: 'network.mode.socks5',
  http: 'network.mode.http',
  https: 'network.mode.https',
  wireguard: 'network.mode.wireguard',
  vpn: 'network.mode.vpn',
} as const;

interface NetworkConfig {
  egressMode?: string | null;
  proxyAddr?: string | null;
  expectedEgressIp?: string | null;
  failoverProxyAddrs?: string[] | null;
}

export default function NetworkForm({
  modelId,
  initial,
}: {
  modelId: string;
  initial: NetworkConfig | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<string>(initial?.egressMode ?? '');
  const [proxyAddr, setProxyAddr] = useState(initial?.proxyAddr ?? '');
  const [expectedIp, setExpectedIp] = useState(initial?.expectedEgressIp ?? '');
  const [failoverProxyAddrs, setFailoverProxyAddrs] = useState(
    initial?.failoverProxyAddrs?.join('\n') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) {
      setError(t('network.chooseConnection'));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const proxyMode = mode === 'socks5' || mode === 'http' || mode === 'https';
      const body = {
        egressMode: mode,
        proxyType: proxyMode ? mode : null,
        proxyAddr: proxyMode ? proxyAddr.trim() || null : null,
        expectedEgressIp: expectedIp.trim() || null,
        failoverProxyAddrs: proxyMode
          ? failoverProxyAddrs.split(/\r?\n/).map((address) => address.trim()).filter(Boolean)
          : [],
      };
      const res = await mutationFetch(`/api/v1/models/${modelId}/network`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await readDashboardError(res);
        setError(b?.error?.message ?? t('network.saveFailed'));
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError(t('network.connectionError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" style={{ maxWidth: 480 }}>
      <div>
        <label htmlFor="mode">{t('network.modeLabel')}</label>
        <select id="mode" required value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="" disabled>
            {t('network.chooseMode')}
          </option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(MODE_LABEL_KEYS[m])}
            </option>
          ))}
        </select>
      </div>
      {mode === 'direct' && <p role="status">{t('network.directWarning')}</p>}
      {(mode === 'socks5' || mode === 'http' || mode === 'https') && (
        <>
          <div>
            <label htmlFor="proxyAddr">{t('network.proxyAddressLabel')}</label>
            <input
              id="proxyAddr"
              value={proxyAddr}
              onChange={(e) => setProxyAddr(e.target.value)}
              placeholder={t('network.proxyPlaceholder')}
              required
            />
          </div>
          <div>
            <label htmlFor="failoverProxyAddrs">{t('network.failoverProxyAddrsLabel')}</label>
            <textarea
              id="failoverProxyAddrs"
              value={failoverProxyAddrs}
              onChange={(e) => setFailoverProxyAddrs(e.target.value)}
              aria-describedby="failoverProxyAddrsHint"
              rows={4}
              spellCheck={false}
            />
            <p id="failoverProxyAddrsHint" className="subtle">
              {t('network.failoverProxyAddrsHint')}
            </p>
          </div>
        </>
      )}
      <div>
        <label htmlFor="expectedIp">{t('network.expectedIpLabel')}</label>
        <input
          id="expectedIp"
          value={expectedIp}
          onChange={(e) => setExpectedIp(e.target.value)}
          placeholder={t('network.expectedIpPlaceholder')}
        />
      </div>
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      {done && <p style={{ color: 'var(--good)', margin: 0 }}>{t('network.saved')}</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t('network.saving') : t('network.save')}
        </button>
      </div>
    </form>
  );
}
