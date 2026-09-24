import { api, getSession } from '@/lib/api';
import { CATALOGS, LocaleCatalog, normalizeLocale } from '@axiom/core';
import type { PlaybookGuideline } from '@/lib/api';
import Link from 'next/link';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import PerformancePatterns, { type PerformancePattern } from '@/components/PerformancePatterns';
import GenerateViralInsightButton from '@/components/GenerateViralInsightButton';
import ViralInsightScheduleControl from '@/components/ViralInsightScheduleControl';
import ViralPatternSharingControl from '@/components/ViralPatternSharingControl';

export const dynamic = 'force-dynamic';

interface AnalyticsData {
  windowDays: number;
  totals: { views: number; likes: number; shares: number; comments: number };
  perPlatform: Array<{
    platform: string;
    views: number;
    likes: number;
    shares: number;
    comments: number;
    engagementRate: number;
  }>;
  daily: Array<{ day: string; views: number; likes: number }>;
  postsWithMetrics: number;
  postPerformance?: Array<{
    targetId: string;
    platform: string;
    publishedAt: string;
    collectedAt: string;
    views: number;
    likes: number;
    shares: number;
    comments: number;
    engagementRate: number;
    providerMetrics: Record<string, number>;
    linkClicks: number;
    linkClickRate: number | null;
    subscriptions: number;
    ppvPurchases: number;
    refunds: number;
    revenueByCurrency: Record<string, number>;
  }>;
}

interface ViralData {
  patterns?: { groups: PerformancePattern[]; truncated: boolean; minimumSample: number };
  totalExemplars: number;
  byLabel: Array<{ label: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  top: Array<{ id: string; platform: string; label: string; perfScore: number }>;
}

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const role = session?.user?.role;
  const canManageViralInsightSchedule = role === 'owner' || role === 'manager';
  let uiLocale = 'en';
  try {
    uiLocale = (await api.uiLocale.get()).data.locale;
  } catch {
    /* use the safe fallback */
  }
  const locale = normalizeLocale(uiLocale) ?? 'en';
  const catalog = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) =>
    catalog.t(locale, key, values);
  const number = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  if (!talentDestinationAllowed(role, 'analytics'))
    return (
      <div className="card stack">
        <h2>{t('analytics.analyticsAccessUnavailable')}</h2>
        <p>{t('analytics.analyticsAccessDenied')}</p>
        <Link href="/">{t('analytics.backToWorkspace')}</Link>
      </div>
    );
  const reportMonth = new Date().toISOString().slice(0, 7);
  let analytics: AnalyticsData | null = null;
  let viral: ViralData | null = null;
  let viralInsightScheduleEnabled: boolean | null = null;
  let viralPatternSharingEnabled: boolean | null = null;
  let playbookGuidelines: PlaybookGuideline[] | null = null;
  let playbookUnavailable = false;
  try {
    analytics = (await api.models.analytics(id, 30)).data as unknown as AnalyticsData;
  } catch {
    analytics = null;
  }
  try {
    viral = (await api.models.viral(id)).data as unknown as ViralData;
  } catch {
    viral = null;
  }
  if (canManageViralInsightSchedule) {
    try {
      viralInsightScheduleEnabled = (await api.models.viralInsightSchedule(id)).data.enabled;
    } catch {
      viralInsightScheduleEnabled = null;
    }
  }
  try {
    viralPatternSharingEnabled = (await api.models.viralPatternSharing(id)).data.enabled;
  } catch {
    viralPatternSharingEnabled = null;
  }
  try {
    playbookGuidelines = (await api.models.playbookGuidelines(id)).data;
  } catch {
    playbookUnavailable = true;
  }

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <h2 style={{ margin: 0 }}>{t('analytics.title')}</h2>
        <a
          className="btn secondary"
          href={`/api/v1/models/${encodeURIComponent(id)}/reports/monthly?month=${reportMonth}`}
        >
          {t('analytics.downloadPdf')}
        </a>
      </div>
      {analytics ? (
        <>
          <div className="grid">
            <div className="card">
              <h3>{t('analytics.views')}</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {number.format(analytics.totals.views)}
              </div>
              <p style={{ color: 'var(--muted)', margin: 0 }}>
                {t('analytics.lastDays', { days: number.format(analytics.windowDays) })}
              </p>
            </div>
            <div className="card">
              <h3>{t('analytics.likes')}</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {number.format(analytics.totals.likes)}
              </div>
            </div>
            <div className="card">
              <h3>{t('analytics.shares')}</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {number.format(analytics.totals.shares)}
              </div>
            </div>
            <div className="card">
              <h3>{t('analytics.comments')}</h3>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {number.format(analytics.totals.comments)}
              </div>
            </div>
          </div>
          <div className="card">
            <h3>{t('analytics.perPlatform')}</h3>
            {analytics.perPlatform.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>{t('analytics.noMetrics')}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('analytics.platform')}</th>
                    <th>{t('analytics.views')}</th>
                    <th>{t('analytics.likes')}</th>
                    <th>{t('analytics.shares')}</th>
                    <th>{t('analytics.comments')}</th>
                    <th>{t('analytics.engagement')}</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.perPlatform.map((p) => (
                    <tr key={p.platform}>
                      <td>{p.platform}</td>
                      <td>{number.format(p.views)}</td>
                      <td>{number.format(p.likes)}</td>
                      <td>{number.format(p.shares)}</td>
                      <td>{number.format(p.comments)}</td>
                      <td>{percent.format(p.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {analytics.daily.length > 0 && (
            <div className="card">
              <h3>{t('analytics.dailyTrend', { days: number.format(Math.min(analytics.daily.length, 14)) })}</h3>
              <table>
                <thead>
                  <tr>
                    <th>{t('analytics.day')}</th>
                    <th>{t('analytics.views')}</th>
                    <th>{t('analytics.likes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.daily.slice(-14).map((d) => (
                    <tr key={d.day}>
                      <td>{day.format(new Date(`${d.day}T00:00:00Z`))}</td>
                      <td>{number.format(d.views)}</td>
                      <td>{number.format(d.likes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card stack">
            <h3>{t('analytics.postPerformance')}</h3>
            <p className="subtle">{t('analytics.postPerformanceScope')}</p>
            {(analytics.postPerformance ?? []).length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>{t('analytics.postPerformanceEmpty')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t('analytics.post')}</th>
                      <th>{t('analytics.collectedAt')}</th>
                      <th>{t('analytics.views')}</th>
                      <th>{t('analytics.reach')}</th>
                      <th>{t('analytics.likes')}</th>
                      <th>{t('analytics.saves')}</th>
                      <th>{t('analytics.shares')}</th>
                      <th>{t('analytics.comments')}</th>
                      <th>{t('analytics.providerClicks')}</th>
                      <th>{t('analytics.watchTime')}</th>
                      <th>{t('analytics.linkClicks')}</th>
                      <th>{t('analytics.linkClickRate')}</th>
                      <th>{t('analytics.subscriptions')}</th>
                      <th>{t('analytics.ppvPurchases')}</th>
                      <th>{t('analytics.refunds')}</th>
                      <th>{t('analytics.revenue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.postPerformance!.map((post) => {
                      const observed = (name: string) => {
                        const value = post.providerMetrics[name];
                        return value === undefined ? t('analytics.notReported') : number.format(value);
                      };
                      const revenue = Object.entries(post.revenueByCurrency)
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([currency, cents]) => new Intl.NumberFormat(locale, {
                          style: 'currency', currency, maximumFractionDigits: 2,
                        }).format(cents / 100))
                        .join(', ') || t('analytics.notReported');
                      return (
                        <tr key={post.targetId}>
                          <td><span className="mono">{post.platform} · {post.targetId.slice(0, 8)}</span></td>
                          <td>{dateTime.format(new Date(post.collectedAt))}</td>
                          <td>{number.format(post.views)}</td>
                          <td>{observed('reach')}</td>
                          <td>{number.format(post.likes)}</td>
                          <td>{observed('saves')}</td>
                          <td>{number.format(post.shares)}</td>
                          <td>{number.format(post.comments)}</td>
                          <td>{observed('clicks')}</td>
                          <td>{observed('watch_time')}</td>
                          <td>{number.format(post.linkClicks)}</td>
                          <td>{post.linkClickRate === null ? t('analytics.notReported') : percent.format(post.linkClickRate)}</td>
                          <td>{number.format(post.subscriptions)}</td>
                          <td>{number.format(post.ppvPurchases)}</td>
                          <td>{number.format(post.refunds)}</td>
                          <td>{revenue}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card">
          <p style={{ color: 'var(--muted)' }}>{t('analytics.noAnalytics')}</p>
        </div>
      )}

      <section className="card stack" aria-label={t('analytics.playbookAria')}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>{t('analytics.playbookContext')}</h3>
            <p className="subtle" style={{ margin: 0 }}>
              {t('analytics.playbookContextDescription')}
            </p>
          </div>
          <Link href={`/models/${encodeURIComponent(id)}/playbook`}>
            {t('analytics.reviewPlaybook')}
          </Link>
        </div>
        {playbookUnavailable ? (
          <p role="alert">{t('analytics.playbookLoadFailed')}</p>
        ) : !playbookGuidelines?.length ? (
          <p className="subtle">{t('analytics.noGuidelines')}</p>
        ) : (
          <div className="grid">
            {playbookGuidelines.map((guideline) => (
              <article className="card" key={guideline.id} style={{ background: 'var(--panel2)' }}>
                <strong>
                  {guideline.platform} · {t('analytics.revision', { revision: number.format(guideline.revision) })}
                </strong>
                <p>{t('analytics.cadenceTarget', { count: number.format(guideline.cadencePerWeek) })}</p>
                <p>
                  {t('analytics.suggestedTimes', {
                    times: guideline.optimalTimes.length
                      ? guideline.optimalTimes.join(', ')
                      : t('analytics.noneSaved'),
                  })}
                </p>
                <p className="subtle">
                  {t('analytics.upsellStrategy', {
                    value: guideline.upsellStrategy || t('analytics.noneConfigured'),
                  })}
                  .
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end', marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>{t('analytics.viralInsights')}</h2>
        <GenerateViralInsightButton modelId={id} />
      </div>
      <ViralInsightScheduleControl
        modelId={id}
        initialEnabled={viralInsightScheduleEnabled}
        canManage={canManageViralInsightSchedule}
      />
      <ViralPatternSharingControl
        modelId={id}
        initialEnabled={viralPatternSharingEnabled}
        canManage={canManageViralInsightSchedule}
      />
      <PerformancePatterns patterns={viral?.patterns} />
      <p className="subtle">{t('analytics.verifiedExemplarDisclaimer')}</p>
      <div className="card">
        {!viral ? (
          <p role="alert">{t('analytics.viralLoadFailed')}</p>
        ) : viral.totalExemplars === 0 ? (
          <p style={{ color: 'var(--muted)' }}>{t('analytics.noVerifiedExemplars')}</p>
        ) : (
          <div className="grid">
            <div className="card" style={{ background: 'var(--panel2)' }}>
              <h3>{t('analytics.labels')}</h3>
              {viral.byLabel.map((l) => (
                <div key={l.label} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{l.label}</span>
                  <strong>{number.format(l.count)}</strong>
                </div>
              ))}
            </div>
            <div className="card" style={{ background: 'var(--panel2)' }}>
              <h3>{t('analytics.byPlatform')}</h3>
              {viral.byPlatform.map((p) => (
                <div key={p.platform} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{p.platform}</span>
                  <strong>{number.format(p.count)}</strong>
                </div>
              ))}
            </div>
            <div className="card" style={{ background: 'var(--panel2)' }}>
              <h3>{t('analytics.topPerformers')}</h3>
              {viral.top.slice(0, 5).map((t) => (
                <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono">{t.platform}</span>
                  <span className={`badge ${t.label === 'viral' ? 'good' : 'warn'}`}>
                    {t.label} · {decimal.format(t.perfScore ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
