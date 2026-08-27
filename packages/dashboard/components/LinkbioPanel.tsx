'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';

const KINDS = ['native'] as const;

interface ProviderRow {
  id: string;
  kind: string;
  enabled: boolean;
  isPrimary: boolean;
  clicks?: number;
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

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const res = await mutationFetch(`/api/v1/models/${modelId}/linkbio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, config: {} }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
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
        const b = await res.json().catch(() => ({}));
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
      <div className="row">
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
      </div>
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
    </div>
  );
}
