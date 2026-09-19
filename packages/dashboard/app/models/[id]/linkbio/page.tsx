import { api, getSession } from '@/lib/api';
import LinkbioPanel from '@/components/LinkbioPanel';

export const dynamic = 'force-dynamic';

interface ProviderRow {
  id: string;
  kind: string;
  enabled: boolean;
  isPrimary: boolean;
  clicks?: number;
  config?: Record<string, unknown> | null;
}

interface LinkbioAnalytics {
  providers: ProviderRow[];
  totalClicks: number;
  topTargets: Array<{ target: string; count: number }>;
}

interface LinkbioAttribution {
  currency: string;
  totalClicks: number;
  attributedConversions: number;
  unattributedConversions: number;
  attributedRevenueCents: number;
  conversionRate: number;
  roi: number | null;
  roiStatus: string;
  links: Array<{ slug: string; targetUrl: string; clicks: number; conversions: number; revenueCents: number }>;
}

interface LinkbioData {
  providers: ProviderRow[];
  primary: ProviderRow | null;
  nativeEnabled: boolean;
}

export default async function LinkbioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let data: LinkbioData | null = null;
  let analytics: LinkbioAnalytics | null = null;
  let attribution: LinkbioAttribution | null = null;
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
  try {
    attribution = (await api.models.linkbioAttribution(id)).data as unknown as LinkbioAttribution;
  } catch {
    attribution = null;
  }

  return (
    <div>
      <h2>Link in bio</h2>
      <div className="card">
        <h3>Providers</h3>
        {!data || data.providers.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No provider enabled. The native page requires nothing external — enable it to serve a
            first-party link page.
          </p>
        ) : (
          <p style={{ color: 'var(--muted)' }}>
            {data.providers.filter((p) => p.enabled).length} active provider(s)
            {data.primary ? ` — primary: ${data.primary.kind}` : ''}
          </p>
        )}
        <LinkbioPanel modelId={id} providers={data?.providers ?? []} canEdit={canEdit} />
      </div>
      {data?.nativeEnabled && (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Public page:{' '}
          <a href={`/linkbio/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
            /linkbio/{id}
          </a>
        </p>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        External Linktree, Beacons, and Fanlynks adapters are not available in this release.
      </p>
      {analytics && analytics.totalClicks > 0 && (
        <div className="card">
          <h3>Click analytics</h3>
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
      {attribution && (
        <div className="card">
          <h3>Fanvue attribution</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            Revenue facts joined from authoritative Fanvue events. ROI stays unavailable until campaign cost data is configured.
          </p>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <span><strong>{attribution.totalClicks}</strong> tracked clicks</span>
            <span><strong>{attribution.attributedConversions}</strong> attributed conversions</span>
            <span><strong>{attribution.unattributedConversions}</strong> unattributed conversions</span>
            <span><strong>{(attribution.attributedRevenueCents / 100).toFixed(2)} {attribution.currency}</strong> attributed revenue</span>
            <span><strong>{(attribution.conversionRate * 100).toFixed(2)}%</strong> click-to-conversion</span>
          </div>
          {attribution.links.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>Short link</th><th>Clicks</th><th>Conversions</th><th>Revenue</th></tr></thead>
              <tbody>{attribution.links.map((link) => (
                <tr key={link.slug}>
                  <td>{link.slug}</td>
                  <td>{link.clicks}</td>
                  <td>{link.conversions}</td>
                  <td>{(link.revenueCents / 100).toFixed(2)} {attribution.currency}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
