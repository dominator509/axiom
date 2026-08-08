import { api } from '@/lib/api';
import LinkbioPanel from '@/components/LinkbioPanel';

export const dynamic = 'force-dynamic';

interface ProviderRow {
  id: string;
  kind: string;
  enabled: boolean;
  isPrimary: boolean;
  clicks?: number;
}

interface LinkbioAnalytics {
  providers: ProviderRow[];
  totalClicks: number;
  topTargets: Array<{ target: string; count: number }>;
}

interface LinkbioData {
  providers: ProviderRow[];
  primary: ProviderRow | null;
  nativeEnabled: boolean;
}

export default async function LinkbioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: LinkbioData | null = null;
  let analytics: LinkbioAnalytics | null = null;
  try {
    data = (await api.models.linkbio(id)).data as unknown as LinkbioData;
  } catch {
    data = null;
  }
  try {
    analytics = (await api.models.linkbioAnalytics(id)).data as unknown as LinkbioAnalytics;
  } catch {
    analytics = null;
  }

  return (
    <div>
      <h2>Link-in-bio (F-48..F-53)</h2>
      <div className="card">
        <h3>Providers</h3>
        {!data || data.providers.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No providers enabled. The Native provider requires nothing external — enable it to serve
            a link page.
          </p>
        ) : (
          <p style={{ color: 'var(--muted)' }}>
            {data.providers.filter((p) => p.enabled).length} active provider(s)
            {data.primary ? ` — primary: ${data.primary.kind}` : ''}
          </p>
        )}
        <LinkbioPanel modelId={id} providers={data?.providers ?? []} />
      </div>
      {analytics && analytics.totalClicks > 0 && (
        <div className="card">
          <h3>Click analytics (F-53)</h3>
          <strong>Total clicks: {analytics.totalClicks}</strong>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Target</th>
                <th>Clicks</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topTargets.map((t) => (
                <tr key={t.target}>
                  <td>{t.target}</td>
                  <td>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
