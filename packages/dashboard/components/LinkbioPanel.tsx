'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const KINDS = ['native'] as const;

interface ProviderRow {
  id: string;
  kind: string;
  enabled: boolean;
  isPrimary: boolean;
  clicks?: number;
  config?: Record<string, unknown> | null;
}

interface NativeLink {
  label: string;
  url: string;
  utm?: Record<string, string>;
}

function readLinks(config: Record<string, unknown> | null | undefined): NativeLink[] {
  if (!config || !Array.isArray(config.links)) return [];
  return config.links.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (typeof record.label !== 'string' || typeof record.url !== 'string') return [];
    const utm =
      record.utm && typeof record.utm === 'object' && !Array.isArray(record.utm)
        ? Object.fromEntries(
            Object.entries(record.utm).filter(([, value]) => typeof value === 'string') as Array<
              [string, string]
            >,
          )
        : undefined;
    return [{ label: record.label, url: record.url, ...(utm ? { utm } : {}) }];
  });
}

export default function LinkbioPanel({
  modelId,
  providers,
  canEdit = false,
}: {
  modelId: string;
  providers: ProviderRow[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('native');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef<{ path: string; method: 'POST' | 'DELETE'; body: string; label: string; enabled: boolean; key: string } | null>(null);
  const native = providers.find((provider) => provider.kind === 'native');
  const activeNative = native?.enabled ? native : undefined;
  const [links, setLinks] = useState<NativeLink[]>(() => readLinks(native?.config));
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  async function runMutation(next?: { path: string; method: 'POST' | 'DELETE'; body: string; label: string; enabled: boolean }) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true);
    setPending(true);
    setError(null);
    try {
      const res = await mutationFetch(request.path, {
        method: request.method,
        ...(request.method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: request.body } : {}),
      }, { idempotencyKey: request.key, retries: 0 });
      if (!res.ok) {
        const b = await readDashboardError(res);
        if ([400, 401, 403, 404, 409, 422].includes(res.status)) {
          intent.current = null;
          setPending(false);
        }
        setError(b?.error?.message ?? 'Enable failed');
        return;
      }
      const result = await readDashboardJson<{ data?: { kind?: unknown; enabled?: unknown } }>(res);
      if (result.data?.kind !== 'native' || result.data.enabled !== request.enabled) throw new Error('Unconfirmed link-in-bio change');
      intent.current = null;
      setPending(false);
      router.refresh();
    } catch {
      setError('Change not confirmed. Retry the same link-in-bio change.');
    } finally {
      setBusy(false);
    }
  }

  function enable() {
    if (!canEdit || activeNative || busy) return;
    return runMutation({ path: `/api/v1/models/${modelId}/linkbio`, method: 'POST', body: JSON.stringify({ kind }), label: 'Enable native page', enabled: true });
  }

  function disable(k: string) {
    if (!canEdit || busy) return;
    return runMutation({ path: `/api/v1/models/${modelId}/linkbio/${k}`, method: 'DELETE', body: '', label: 'Disable link-in-bio page', enabled: false });
  }

  function addLink() {
    const nextLabel = label.trim();
    const nextUrl = url.trim();
    if (!nextLabel || !nextUrl) {
      setError('A link label and URL are required');
      return;
    }
    if (nextLabel.length > 120 || nextUrl.length > 2048) {
      setError('Link labels must be at most 120 characters and URLs at most 2048 characters.');
      return;
    }
    try {
      const parsed = new URL(nextUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
      setError('Links must use an http(s) URL');
      return;
    }
    setLinks((current) => [...current, { label: nextLabel, url: nextUrl }]);
    setLabel('');
    setUrl('');
    setError(null);
  }

  function saveLinks() {
    if (!canEdit || !activeNative || busy) return;
    return runMutation({
      path: `/api/v1/models/${modelId}/linkbio`,
      method: 'POST',
      body: JSON.stringify({ kind: 'native', config: { ...activeNative.config, links } }),
      label: 'Save native links',
      enabled: true,
    });
  }

  return (
    <div className="stack">
      {providers.filter((p) => p.enabled).length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Primary</th>
              <th>Clicks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {providers
              .filter((p) => p.enabled)
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.kind}</td>
                  <td>{p.isPrimary ? '★' : '—'}</td>
                  <td>{p.clicks ?? 0}</td>
                  <td>
                    <button
                      className="btn danger"
                      type="button"
                      disabled={busy || pending || !canEdit}
                      onClick={() => disable(p.kind)}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      Disable
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {activeNative && (
        <div className="stack" style={{ marginTop: 12 }}>
          <h4 style={{ margin: 0 }}>Native page links</h4>
          {links.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>No links configured.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {links.map((link, index) => (
                <li key={`${link.url}-${index}`}>
                  {link.label} — {link.url}{' '}
                  <button
                    className="btn danger"
                    type="button"
                    disabled={busy}
                    onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
                    style={{ padding: '2px 8px', fontSize: 11 }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canEdit ? <fieldset className="stack" disabled={busy || pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
            <div className="row">
              <input aria-label="Link label" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
              <input aria-label="Link URL" maxLength={2048} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              <button className="btn" type="button" onClick={addLink}>Add link</button>
              <button className="btn" type="button" onClick={saveLinks}>{pending ? 'Retry same link-in-bio change' : 'Save links'}</button>
            </div>
          </fieldset> : <p className="subtle">Editing the native page requires an owner, manager or operator role.</p>}
        </div>
      )}
      {!activeNative && canEdit && <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.filter((k) => !providers.some((p) => p.kind === k && p.enabled)).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button className="btn" type="button" disabled={busy} onClick={enable}>
          Enable native page
        </button>
      </div>}
      {pending && <button type="button" className="btn secondary" disabled={busy} onClick={() => void runMutation()}>Retry same link-in-bio change</button>}
      {!canEdit && <p className="subtle">Link-in-bio changes require an owner, manager or operator role.</p>}
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
    </div>
  );
}
