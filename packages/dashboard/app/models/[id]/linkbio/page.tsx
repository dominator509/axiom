import { api, getSession } from '@/lib/api';
import LinkbioPanel from '@/components/LinkbioPanel';
import LinkbioCostManager from '@/components/LinkbioCostManager';
import LinkbioPostLinkManager from '@/components/LinkbioPostLinkManager';
import { getServerLocale } from '@/lib/server-locale';
import { formatNumber } from '@axiom/core';

export const dynamic = 'force-dynamic';

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
  analyticsConnection?: {
    analyticsConnected: boolean;
    propertyId: string | null;
    status: string;
    lastSyncedAt: string | null;
  } | null;
  analyticsConnectionUnavailable?: boolean;
}

interface LinkbioAnalytics {
  providers: ProviderRow[];
  totalClicks: number;
  totals?: { visits: number; activeUsers: number; analyticsClicks: number; conversions: number; trackedClicks: number };
  topTargets: Array<{ providerId: string; kind: string; target: string; trackedClicks: number; visits: number; analyticsClicks: number; conversions: number }>;
  daily?: Array<{ date: string; visits: number; activeUsers: number; analyticsClicks: number; conversions: number }>;
  note?: string;
}

interface LinkbioAttribution {
  currency: string | null;
  totalClicks: number;
  attributedConversions: number;
  unattributedConversions: number;
  attributedRevenueCents: number;
  conversionRate: number;
  roi: number | null;
  roiStatus: string;
  attributedRevenueByCurrency?: Record<string, number>;
  campaignCostByCurrency?: Record<string, number>;
  roiByCurrency?: Record<string, number | null>;
  links: Array<{ id: string; slug: string; targetUrl: string; postTargetId?: string | null; clicks: number; conversions: number; revenueCents: number; costCents: number; roiPercent: number | null; revenueByCurrency?: Record<string, number>; costByCurrency?: Record<string, number>; roiByCurrency?: Record<string, number | null> }>;
}

interface LinkbioPostLinks {
  publishedPosts: Array<{ id: string; platform: string; publishedAt: string | null; caption: string }>;
  links: Array<{ id: string; slug: string; targetUrl: string; postTargetId: string; clicks: number; createdAt: string; path: string }>;
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
  const canConnectAnalytics = ['owner', 'manager'].includes(session?.user?.role ?? '');
  let data: LinkbioData | null = null;
  let analytics: LinkbioAnalytics | null = null;
  let attribution: LinkbioAttribution | null = null;
  let postLinks: LinkbioPostLinks | null = null;
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
  if (data) {
    const connections = canEdit
      ? await Promise.all(data.providers.map(async (provider) => {
          if (provider.kind === 'native') return { connection: null, unavailable: false };
          try { return { connection: (await api.models.linkbioAnalyticsConnection(id, provider.kind)).data, unavailable: false }; }
          catch { return { connection: null, unavailable: true }; }
        }))
      : data.providers.map(() => ({ connection: null, unavailable: false }));
    data = {
      ...data,
      providers: data.providers.map((provider, index) => ({
        ...provider,
        clicks: analytics?.providers.find((item) => item.id === provider.id)?.clicks ?? 0,
        analyticsConnection: connections[index]?.connection,
        analyticsConnectionUnavailable: connections[index]?.unavailable,
      })),
    };
  }
  try {
    attribution = (await api.models.linkbioAttribution(id)).data as unknown as LinkbioAttribution;
  } catch {
    attribution = null;
  }
  try {
    postLinks = (await api.models.linkbioPostLinks(id)).data as LinkbioPostLinks;
  } catch {
    postLinks = null;
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
  const formatCurrencyTotals = (totals: Record<string, number> | undefined, fallbackCents: number) => {
    const entries = Object.entries(totals ?? {}).filter(([currency, cents]) => /^[A-Z]{3}$/.test(currency) && Number.isSafeInteger(cents));
    if (entries.length === 0) return formatCurrency(fallbackCents, attribution?.currency ?? 'USD');
    return entries.sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, cents]) => formatCurrency(cents, currency)).join(' · ');
  };
  const formatRoiTotals = (values: Record<string, number | null> | undefined, fallback: number | null) => {
    const entries = Object.entries(values ?? {}).filter(([currency, value]) => /^[A-Z]{3}$/.test(currency) && typeof value === 'number' && Number.isFinite(value));
    if (entries.length === 0) return fallback == null ? '—' : `${fallback.toLocaleString(locale)}%`;
    return entries.sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, value]) => `${currency} ${Number(value).toLocaleString(locale)}%`).join(' · ');
  };
  const hostedPage = data?.providers.find((provider) => provider.enabled && (provider.kind === 'native' || provider.kind === 'fanlynks'));
  const publicPagePath = hostedPage?.kind === 'fanlynks' ? `/linkbio/fanlynks/${encodeURIComponent(id)}`
    : hostedPage?.kind === 'native' ? `/linkbio/${encodeURIComponent(id)}` : null;

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
        <LinkbioPanel modelId={id} providers={data?.providers ?? []} canEdit={canEdit} canConnectAnalytics={canConnectAnalytics} />
      </div>
      {data?.nativeEnabled && postLinks && <LinkbioPostLinkManager modelId={id} posts={postLinks.publishedPosts} links={postLinks.links} canEdit={canEdit} />}
      {publicPagePath && (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          {t('modelSurface.publicPage')}{' '}
          <a href={publicPagePath} target="_blank" rel="noreferrer">
            {publicPagePath}
          </a>
        </p>
      )}
      {analytics && (
        <div className="card">
          <h3>{t('modelSurface.clickAnalytics')}</h3>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <strong>{t('linkbio.analytics.trackedClicks', { count: formatNumber(analytics.totals?.trackedClicks ?? analytics.totalClicks, locale) })}</strong>
            <strong>{t('linkbio.analytics.visits', { count: formatNumber(analytics.totals?.visits ?? 0, locale) })}</strong>
            <strong>{t('linkbio.analytics.activeUsers', { count: formatNumber(analytics.totals?.activeUsers ?? 0, locale) })}</strong>
            <strong>{t('linkbio.analytics.importedClicks', { count: formatNumber(analytics.totals?.analyticsClicks ?? 0, locale) })}</strong>
            <strong>{t('linkbio.analytics.conversions', { count: formatNumber(analytics.totals?.conversions ?? 0, locale) })}</strong>
          </div>
          <p className="subtle">{t('linkbio.analytics.note')}</p>
          {analytics.totalClicks === 0 && (analytics.totals?.visits ?? 0) === 0 && (analytics.totals?.analyticsClicks ?? 0) === 0 && (analytics.totals?.conversions ?? 0) === 0
            ? <p>{t('linkbio.analytics.noData')}</p> : null}
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t('linkbio.kind')}</th>
                <th>{t('modelSurface.target')}</th>
                <th>{t('linkbio.analytics.trackedClicksLabel')}</th>
                <th>{t('linkbio.analytics.visitsLabel')}</th>
                <th>{t('linkbio.analytics.importedClicksLabel')}</th>
                <th>{t('linkbio.analytics.conversionsLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topTargets.map((target) => (
                <tr key={`${target.providerId}-${target.target}`}>
                  <td>{target.kind}</td>
                  <td>{target.target}</td>
                  <td>{formatNumber(target.trackedClicks, locale)}</td>
                  <td>{formatNumber(target.visits, locale)}</td>
                  <td>{formatNumber(target.analyticsClicks, locale)}</td>
                  <td>{formatNumber(target.conversions, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {analytics.daily && analytics.daily.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>{t('linkbio.analytics.date')}</th><th>{t('linkbio.analytics.visitsLabel')}</th><th>{t('linkbio.analytics.activeUsersLabel')}</th><th>{t('linkbio.analytics.importedClicksLabel')}</th><th>{t('linkbio.analytics.conversionsLabel')}</th></tr></thead>
              <tbody>{analytics.daily.map((day) => <tr key={day.date}>
                <td>{day.date}</td><td>{formatNumber(day.visits, locale)}</td><td>{formatNumber(day.activeUsers, locale)}</td>
                <td>{formatNumber(day.analyticsClicks, locale)}</td><td>{formatNumber(day.conversions, locale)}</td>
              </tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      {!analytics && <div className="card"><p>{t('linkbio.analytics.unavailable')}</p></div>}
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
            <span><strong>{t('modelSurface.attributedRevenue', { amount: formatCurrencyTotals(attribution.attributedRevenueByCurrency, attribution.attributedRevenueCents) })}</strong></span>
            <span><strong>{t('modelSurface.clickToConversion', { rate: formatPercent(attribution.conversionRate) })}</strong></span>
            <span><strong>{t('modelSurface.netRoiByCurrency', { amount: formatRoiTotals(attribution.roiByCurrency, attribution.roi) })}</strong></span>
          </div>
          {attribution.links.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>{t('modelSurface.shortLink')}</th><th>{t('modelSurface.clicks')}</th><th>{t('modelSurface.conversions')}</th><th>{t('modelSurface.revenue')}</th></tr></thead>
              <tbody>{attribution.links.map((link) => (
                <tr key={link.slug}>
                  <td>{link.slug}</td>
                  <td>{formatNumber(link.clicks, locale)}</td>
                  <td>{formatNumber(link.conversions, locale)}</td>
                  <td>{formatCurrencyTotals(link.revenueByCurrency, link.revenueCents)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <LinkbioCostManager modelId={id} links={attribution.links.map((link) => ({
            id: link.id, slug: link.slug, revenueCents: link.revenueCents, costCents: link.costCents,
            roiPercent: link.roiPercent, currency: attribution.currency,
            revenueByCurrency: link.revenueByCurrency,
            costByCurrency: link.costByCurrency,
            roiByCurrency: link.roiByCurrency,
          }))} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}
