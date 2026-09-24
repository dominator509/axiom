import { api, getSession } from '@/lib/api';
import LinkbioPanel from '@/components/LinkbioPanel';
import { getServerLocale } from '@/lib/server-locale';
import { formatNumber } from '@axiom/core';

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
  const { locale, t } = await getServerLocale();
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

  const formatCurrency = (cents: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  const formatPercent = (value: number) => new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  return (
    <div>
      <h2>{t('modelSurface.linkbioTitle')}</h2>
      <div className="card">
        <h3>{t('modelSurface.providers')}</h3>
        {!data || data.providers.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            {t('modelSurface.noProvider')}
          </p>
        ) : (
          <p style={{ color: 'var(--muted)' }}>
            {t('modelSurface.activeProviders', { count: formatNumber(data.providers.filter((p) => p.enabled).length, locale) })}
            {data.primary ? t('modelSurface.primaryProvider', { kind: data.primary.kind }) : ''}
          </p>
        )}
        <LinkbioPanel modelId={id} providers={data?.providers ?? []} canEdit={canEdit} />
      </div>
      {data?.nativeEnabled && (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          {t('modelSurface.publicPage')}{' '}
          <a href={`/linkbio/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
            /linkbio/{id}
          </a>
        </p>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        {t('modelSurface.externalAdaptersUnavailable')}
      </p>
      {analytics && analytics.totalClicks > 0 && (
        <div className="card">
          <h3>{t('modelSurface.clickAnalytics')}</h3>
          <strong>{t('modelSurface.totalClicks', { count: formatNumber(analytics.totalClicks, locale) })}</strong>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t('modelSurface.target')}</th>
                <th>{t('modelSurface.clicks')}</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topTargets.map((t) => (
                <tr key={t.target}>
                  <td>{t.target}</td>
                  <td>{formatNumber(t.count, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {attribution && (
        <div className="card">
          <h3>{t('modelSurface.fanvueAttribution')}</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            {t('modelSurface.revenueFacts')}
          </p>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <span><strong>{t('modelSurface.trackedClicks', { count: formatNumber(attribution.totalClicks, locale) })}</strong></span>
            <span><strong>{t('modelSurface.attributedConversions', { count: formatNumber(attribution.attributedConversions, locale) })}</strong></span>
            <span><strong>{t('modelSurface.unattributedConversions', { count: formatNumber(attribution.unattributedConversions, locale) })}</strong></span>
            <span><strong>{t('modelSurface.attributedRevenue', { amount: formatCurrency(attribution.attributedRevenueCents, attribution.currency) })}</strong></span>
            <span><strong>{t('modelSurface.clickToConversion', { rate: formatPercent(attribution.conversionRate) })}</strong></span>
          </div>
          {attribution.links.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>{t('modelSurface.shortLink')}</th><th>{t('modelSurface.clicks')}</th><th>{t('modelSurface.conversions')}</th><th>{t('modelSurface.revenue')}</th></tr></thead>
              <tbody>{attribution.links.map((link) => (
                <tr key={link.slug}>
                  <td>{link.slug}</td>
                  <td>{formatNumber(link.clicks, locale)}</td>
                  <td>{formatNumber(link.conversions, locale)}</td>
                  <td>{formatCurrency(link.revenueCents, attribution.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
