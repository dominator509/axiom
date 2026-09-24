'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNumber } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const KINDS = ['native', 'fanlynks', 'linktree', 'beacons'] as const;
type ProviderKind = (typeof KINDS)[number];

interface ProviderAnalyticsConnection {
  analyticsConnected: boolean;
  propertyId: string | null;
  status: string;
  lastSyncedAt: string | null;
}

interface ProviderRow {
  id: string;
  kind: string;
  enabled: boolean;
  isPrimary: boolean;
  status?: string;
  lastSyncedAt?: string | null;
  profileUrl?: string | null;
  clicks?: number;
  config?: Record<string, unknown> | null;
  analyticsConnection?: ProviderAnalyticsConnection | null;
  analyticsConnectionUnavailable?: boolean;
}

interface NativeLink {
  label: string;
  url: string;
  utm?: Record<string, string>;
}

type MutationIntent = {
  path: string;
  method: 'POST' | 'DELETE';
  body: string;
  label: string;
  action: 'provider' | 'analytics-connect' | 'analytics-disconnect' | 'analytics-sync';
  kind: ProviderKind;
  enabled?: boolean;
  key: string;
};

function readLinks(config: Record<string, unknown> | null | undefined): NativeLink[] {
  if (!config || !Array.isArray(config.links)) return [];
  return config.links.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (typeof record.label !== 'string' || typeof record.url !== 'string') return [];
    const utm = record.utm && typeof record.utm === 'object' && !Array.isArray(record.utm)
      ? Object.fromEntries(Object.entries(record.utm).filter(([, item]) => typeof item === 'string') as Array<[string, string]>)
      : undefined;
    return [{ label: record.label, url: record.url, ...(utm ? { utm } : {}) }];
  });
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function LinkbioPanel({
  modelId,
  providers,
  canEdit = false,
  canConnectAnalytics = false,
}: {
  modelId: string;
  providers: ProviderRow[];
  canEdit?: boolean;
  canConnectAnalytics?: boolean;
}) {
  const { locale = 'en', t } = useLocale();
  const router = useRouter();
  const [kind, setKind] = useState<ProviderKind>((providers.find((provider) => provider.enabled)?.kind as ProviderKind) ?? 'native');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const intent = useRef<MutationIntent | null>(null);
  const selectedProvider = providers.find((provider) => provider.kind === kind);
  const activeProvider = selectedProvider?.enabled ? selectedProvider : undefined;
  const [isPrimary, setIsPrimary] = useState(selectedProvider?.isPrimary ?? false);
  const [links, setLinks] = useState<NativeLink[]>(() => readLinks(selectedProvider?.config));
  const [profileUrl, setProfileUrl] = useState(selectedProvider?.profileUrl ?? '');
  const [accentColor, setAccentColor] = useState(() => {
    const value = selectedProvider?.config?.accentColor;
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#f9fafb';
  });
  const [measurementId, setMeasurementId] = useState('');
  const [propertyId, setPropertyId] = useState(activeProvider?.analyticsConnection?.propertyId ?? '');
  const [clientEmail, setClientEmail] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [startDate, setStartDate] = useState(() => dateDaysAgo(7));
  const [endDate, setEndDate] = useState(() => dateDaysAgo(1));
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  function selectKind(next: ProviderKind) {
    const provider = providers.find((entry) => entry.kind === next);
    setKind(next);
    setIsPrimary(provider?.isPrimary ?? false);
    setLinks(readLinks(provider?.config));
    setProfileUrl(provider?.profileUrl ?? '');
    const color = provider?.config?.accentColor;
    setAccentColor(typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#f9fafb');
    setPropertyId(provider?.analyticsConnection?.propertyId ?? '');
    setMeasurementId('');
    setError(null);
    setNotice(null);
  }

  async function runMutation(next?: Omit<MutationIntent, 'key'>) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await mutationFetch(request.path, {
        method: request.method,
        ...(request.method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: request.body } : {}),
      }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const body = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setError(body?.error?.message ?? t('linkbio.error.enableFailed'));
        return;
      }
      const result = await readDashboardJson<{ data?: Record<string, unknown> }>(response);
      const data = result.data ?? {};
      if (request.action === 'provider' && (data.kind !== request.kind || data.enabled !== request.enabled)) {
        throw new Error(t('linkbio.error.unconfirmed'));
      }
      if (request.action === 'analytics-connect' && (data.kind !== request.kind || data.analyticsConnected !== true)) {
        throw new Error(t('linkbio.error.unconfirmed'));
      }
      if (request.action === 'analytics-disconnect' && data.analyticsConnected !== false) {
        throw new Error(t('linkbio.error.unconfirmed'));
      }
      if (request.action === 'analytics-sync' && (data.kind !== request.kind || typeof data.importedRows !== 'number')) {
        throw new Error(t('linkbio.error.unconfirmed'));
      }
      intent.current = null;
      setPending(false);
      if (request.action === 'analytics-connect') {
        setPrivateKey('');
        setClientEmail('');
        setNotice(t('linkbio.ga4.savedUnverified'));
      } else if (request.action === 'analytics-sync') {
        setNotice(t('linkbio.ga4.syncSucceeded', { count: Number(data.importedRows) }));
      } else if (request.action === 'analytics-disconnect') {
        setNotice(t('linkbio.ga4.disconnected'));
      }
      router.refresh();
    } catch {
      setError(t('linkbio.error.notConfirmed'));
    } finally {
      setBusy(false);
    }
  }

  function addLink() {
    const nextLabel = linkLabel.trim();
    const nextUrl = linkUrl.trim();
    if (!nextLabel || !nextUrl) {
      setError(t('linkbio.error.labelAndUrlRequired'));
      return;
    }
    if (nextLabel.length > 120 || nextUrl.length > 2048 || links.length >= 100) {
      setError(t('linkbio.error.limits'));
      return;
    }
    try {
      const parsed = new URL(nextUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
      setError(t('linkbio.error.httpsRequired'));
      return;
    }
    setLinks((current) => [...current, { label: nextLabel, url: nextUrl }]);
    setLinkLabel('');
    setLinkUrl('');
    setError(null);
  }

  function saveProvider() {
    if (!canEdit || busy) return;
    const publicTracking = selectedProvider?.config?.publicTracking && typeof selectedProvider.config.publicTracking === 'object'
      ? { ...(selectedProvider.config.publicTracking as Record<string, unknown>) } : {};
    if (kind === 'fanlynks') {
      if (measurementId.trim()) publicTracking.ga4MeasurementId = measurementId.trim();
      else delete publicTracking.ga4MeasurementId;
    }
    const config = {
      ...(selectedProvider?.config ?? {}),
      links,
      ...(kind === 'fanlynks' ? { accentColor } : {}),
      ...(kind === 'fanlynks' ? { publicTracking } : {}),
    };
    if (kind === 'linktree' || kind === 'beacons') {
      try {
        const parsed = new URL(profileUrl.trim());
        const host = parsed.hostname.toLowerCase();
        const validHost = kind === 'linktree'
          ? host === 'linktr.ee' || host.endsWith('.linktr.ee')
          : host === 'beacons.ai' || host.endsWith('.beacons.ai');
        if (parsed.protocol !== 'https:' || !validHost) throw new Error();
      } catch {
        setError(t('linkbio.error.profileUrl'));
        return;
      }
    }
    runMutation({
      path: `/api/v1/models/${encodeURIComponent(modelId)}/linkbio`,
      method: 'POST',
      body: JSON.stringify({ kind, config, ...(kind === 'linktree' || kind === 'beacons' ? { profileUrl: profileUrl.trim() } : {}), isPrimary }),
      label: t('linkbio.saveProvider'), action: 'provider', kind, enabled: true,
    });
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setNotice(t('linkbio.copied'));
      setError(null);
    } catch {
      setError(t('linkbio.error.copyFailed'));
    }
  }

  const publicPagePath = kind === 'fanlynks'
    ? `/linkbio/fanlynks/${encodeURIComponent(modelId)}`
    : kind === 'native' ? `/linkbio/${encodeURIComponent(modelId)}` : null;
  const analyticsConnection = activeProvider?.analyticsConnection;
  const needsExternalSetup = kind === 'linktree' || kind === 'beacons';
  return (
    <div className="stack">
      {providers.filter((provider) => provider.enabled).length > 0 && (
        <table>
          <thead><tr><th>{t('linkbio.kind')}</th><th>{t('linkbio.primary')}</th><th>{t('linkbio.clicks')}</th><th>{t('linkbio.status')}</th><th></th></tr></thead>
          <tbody>{providers.filter((provider) => provider.enabled).map((provider) => (
            <tr key={provider.id}>
              <td>{provider.kind}</td><td>{provider.isPrimary ? '★' : '—'}</td>
              <td>{formatNumber(provider.clicks ?? 0, locale)}</td>
              <td>{provider.status === 'connected' ? t('linkbio.statusConnected')
                : provider.status === 'sync_error' ? t('linkbio.statusSyncError')
                  : provider.status === 'disabled' ? t('linkbio.statusDisabled') : t('linkbio.statusConfigured')}</td>
              <td><button className="btn danger" type="button" disabled={busy || pending || !canEdit}
                onClick={() => runMutation({
                  path: `/api/v1/models/${encodeURIComponent(modelId)}/linkbio/${encodeURIComponent(provider.kind)}`,
                  method: 'DELETE', body: '', label: t('linkbio.disable'), action: 'provider',
                  kind: provider.kind as ProviderKind, enabled: false,
                })}>{t('linkbio.disable')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <fieldset className="stack" disabled={busy || pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div className="row">
          <label>{t('linkbio.providerSelect')}
            <select value={kind} onChange={(event) => selectKind(event.target.value as ProviderKind)}>
              {KINDS.map((providerKind) => <option key={providerKind} value={providerKind}>{providerKind}</option>)}
            </select>
          </label>
          {(kind === 'linktree' || kind === 'beacons') && <label>{t('linkbio.profileUrl')}
            <input aria-label={t('linkbio.profileUrl')} type="url" maxLength={2048} value={profileUrl} onChange={(event) => setProfileUrl(event.target.value)} placeholder={kind === 'linktree' ? 'https://linktr.ee/creator' : 'https://beacons.ai/creator'} />
          </label>}
          {kind === 'fanlynks' && <label>{t('linkbio.ga4.measurementId')}
            <input aria-label={t('linkbio.ga4.measurementId')} maxLength={23} value={measurementId} onChange={(event) => setMeasurementId(event.target.value.toUpperCase())} placeholder="G-XXXXXXXXXX" />
          </label>}
          {kind === 'fanlynks' && <label>{t('linkbio.accentColor')}
            <input aria-label={t('linkbio.accentColor')} value={accentColor} onChange={(event) => setAccentColor(event.target.value)} placeholder="#f9fafb" />
          </label>}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={isPrimary} onChange={(event) => {
              setIsPrimary(event.target.checked);
              if (selectedProvider?.enabled) {
                runMutation({
                  path: `/api/v1/models/${encodeURIComponent(modelId)}/linkbio`, method: 'POST',
                  body: JSON.stringify({ kind, config: { ...(selectedProvider.config ?? {}), links }, ...(selectedProvider.profileUrl ? { profileUrl: selectedProvider.profileUrl } : {}), isPrimary: event.target.checked }),
                  label: t('linkbio.primary'), action: 'provider', kind, enabled: true,
                });
              }
            }} disabled={!canEdit} />{t('linkbio.primary')}
          </label>
        </div>

        <h4 style={{ margin: '8px 0 0' }}>{t('linkbio.trackedLinks')}</h4>
        {links.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>{t('linkbio.noLinks')}</p> : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {links.map((link, index) => (
              <li key={`${link.url}-${index}`}>
                {link.label} — {link.url}{' '}
                <button className="btn danger" type="button" disabled={!canEdit || busy} onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t('linkbio.remove')}</button>{' '}
                {activeProvider && <button className="btn secondary" type="button" onClick={() => {
                  const tracked = (activeProvider.config?.links as Array<{ path?: string }> | undefined)?.[index];
                  if (tracked?.path) void copyPath(tracked.path);
                }} disabled={!((activeProvider.config?.links as Array<{ path?: string }> | undefined)?.[index]?.path)}>{t('linkbio.copyTrackedLink')}</button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && <div className="row">
          <input aria-label={t('linkbio.linkLabel')} maxLength={120} value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder={t('linkbio.labelPlaceholder')} />
          <input aria-label={t('linkbio.linkUrl')} maxLength={2048} value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder={t('linkbio.urlPlaceholder')} />
          <button className="btn" type="button" onClick={addLink}>{t('linkbio.addLink')}</button>
        </div>}
        {canEdit && <div className="row">
          <button className="btn" type="button" disabled={busy} onClick={saveProvider}>{activeProvider ? t('linkbio.saveProvider') : t('linkbio.enableProvider')}</button>
          {activeProvider && publicPagePath && <button className="btn secondary" type="button" onClick={() => void copyPath(publicPagePath)}>{t('linkbio.copyPublicPage')}</button>}
        </div>}
        {needsExternalSetup && <p className="subtle">{t('linkbio.externalSetup')}</p>}
        {!activeProvider && needsExternalSetup && <p className="subtle">{t('linkbio.externalProfileRequired')}</p>}
        {activeProvider?.profileUrl && <p><a href={activeProvider.profileUrl} target="_blank" rel="noreferrer">{activeProvider.profileUrl}</a></p>}
      </fieldset>

      {activeProvider && kind !== 'native' && (
        <section className="stack" aria-label={t('linkbio.ga4.title')}>
          <h4 style={{ marginBottom: 0 }}>{t('linkbio.ga4.title')}</h4>
          <p className="subtle">{t('linkbio.ga4.accessInstructions')}</p>
          {activeProvider.analyticsConnectionUnavailable ? <p role="alert">{t('linkbio.ga4.connectionUnavailable')}</p>
            : analyticsConnection?.analyticsConnected ? (
            <>
              <p className="subtle">{analyticsConnection.status === 'connected'
                ? t('linkbio.ga4.lastSynced', { date: analyticsConnection.lastSyncedAt ?? t('linkbio.ga4.neverSynced') })
                : analyticsConnection.status === 'sync_error' ? t('linkbio.ga4.syncError') : t('linkbio.ga4.savedUnverified')}</p>
              <div className="row">
                <label>{t('linkbio.ga4.startDate')}<input aria-label={t('linkbio.ga4.startDate')} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
                <label>{t('linkbio.ga4.endDate')}<input aria-label={t('linkbio.ga4.endDate')} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
                <button className="btn" type="button" disabled={!canEdit || busy || !startDate || !endDate} onClick={() => runMutation({
                  path: `/api/v1/models/${encodeURIComponent(modelId)}/linkbio/${encodeURIComponent(kind)}/analytics-sync`,
                  method: 'POST', body: JSON.stringify({ startDate, endDate }), label: t('linkbio.ga4.sync'), action: 'analytics-sync', kind,
                })}>{t('linkbio.ga4.sync')}</button>
                {canConnectAnalytics && <button className="btn danger" type="button" disabled={busy} onClick={() => runMutation({
                  path: `/api/v1/models/${encodeURIComponent(modelId)}/linkbio/${encodeURIComponent(kind)}/analytics-connection`,
                  method: 'DELETE', body: '', label: t('linkbio.ga4.disconnect'), action: 'analytics-disconnect', kind,
                })}>{t('linkbio.ga4.disconnect')}</button>}
              </div>
            </>
          ) : (
            <fieldset className="stack" disabled={!canConnectAnalytics || busy || pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
              <div className="row">
                <label>{t('linkbio.ga4.propertyId')}<input aria-label={t('linkbio.ga4.propertyId')} inputMode="numeric" maxLength={20} value={propertyId} onChange={(event) => setPropertyId(event.target.value)} /></label>
                <label>{t('linkbio.ga4.clientEmail')}<input aria-label={t('linkbio.ga4.clientEmail')} type="email" maxLength={254} value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} /></label>
              </div>
              <label>{t('linkbio.ga4.privateKey')}<textarea aria-label={t('linkbio.ga4.privateKey')} rows={5} maxLength={8000} value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} autoComplete="off" /></label>
              <button className="btn" type="button" disabled={!canConnectAnalytics || busy || !propertyId || !clientEmail || !privateKey} onClick={() => runMutation({
                path: `/api/v1/models/${encodeURIComponent(modelId)}/linkbio/${encodeURIComponent(kind)}/analytics-connection`,
                method: 'POST', body: JSON.stringify({ propertyId, clientEmail, privateKey }), label: t('linkbio.ga4.connect'), action: 'analytics-connect', kind,
              })}>{t('linkbio.ga4.connect')}</button>
              {!canConnectAnalytics && <p className="subtle">{t('linkbio.ga4.ownerRequired')}</p>}
            </fieldset>
          )}
        </section>
      )}

      {pending && <button type="button" className="btn secondary" disabled={busy} onClick={() => void runMutation()}>{t('linkbio.retry')}</button>}
      {!canEdit && <p className="subtle">{t('linkbio.roleRequired')}</p>}
      {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      {notice && <p role="status" style={{ color: 'var(--good)', margin: 0 }}>{notice}</p>}
    </div>
  );
}
