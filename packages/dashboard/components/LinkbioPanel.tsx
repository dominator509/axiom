'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';

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
}: {
  modelId: string;
  providers: ProviderRow[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('native');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = providers.find((provider) => provider.kind === 'native');
  const activeNative = native?.enabled ? native : undefined;
  const [links, setLinks] = useState<NativeLink[]>(() => readLinks(native?.config));
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  async function enable() {
    if (activeNative || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mutationFetch(`/api/v1/models/${modelId}/linkbio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        const b = await readDashboardError(res);
        setError(b?.error?.message ?? 'Enable failed');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function disable(k: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await mutationFetch(`/api/v1/models/${modelId}/linkbio/${k}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await readDashboardError(res);
        setError(b?.error?.message ?? 'Disable failed');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  function addLink() {
    const nextLabel = label.trim();
    const nextUrl = url.trim();
    if (!nextLabel || !nextUrl) {
      setError('A link label and URL are required');
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

  async function saveLinks() {
    if (!activeNative) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mutationFetch(`/api/v1/models/${modelId}/linkbio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'native', config: { links } }),
      });
      if (!res.ok) {
        const b = await readDashboardError(res);
        setError(b?.error?.message ?? 'Saving links failed');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
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
                      disabled={busy}
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
          <div className="row">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            <button className="btn" type="button" disabled={busy} onClick={addLink}>
              Add link
            </button>
            <button className="btn" type="button" disabled={busy} onClick={saveLinks}>
              Save links
            </button>
          </div>
        </div>
      )}
      {!activeNative && <div className="row">
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
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
    </div>
  );
}
