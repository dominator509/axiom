import Link from 'next/link';
import { api, getSession, type EarningsObservation } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';
import type { MessageKey } from '@axiom/core';

export const dynamic = 'force-dynamic';
const money = (cents: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
const sourceKeys: Record<string, MessageKey> = {
  subs: 'earnings.source.subs', messages: 'earnings.source.messages', posts: 'earnings.source.posts',
  tips: 'earnings.source.tips', referrals: 'earnings.source.referrals', renewals: 'earnings.source.renewals', other: 'earnings.source.other',
};

export default async function EarningsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connectionId?: string | string[] }>;
}) {
  const { id } = await params;
  const { locale, t, dateTime } = await getServerLocale();
  const role = (await getSession())?.user?.role;
  if (!talentDestinationAllowed(role, 'earnings')) return <div className="card stack">
    <h2>{t('earnings.accessTitle')}</h2><p>{t('earnings.accessDescription')}</p><Link href="/">{t('earnings.backToWorkspace')}</Link>
  </div>;
  const query = await searchParams;
  const selected = typeof query.connectionId === 'string' ? query.connectionId : '';
  const path = `/models/${encodeURIComponent(id)}/earnings`;
  let accounts: Array<{ id: string; displayName: string }> | null = null;
  let observation: EarningsObservation | null = null;
  let error: string | null = null;
  try { accounts = (await api.models.earningsAccounts(id)).data.accounts; }
  catch { error = t('earnings.accountsLoadFailed'); }
  if (accounts && selected) {
    if (!accounts.some(account => account.id === selected)) error = t('earnings.accountUnavailable');
    else try { observation = (await api.models.earnings(id, selected)).data; }
    catch { error = t('earnings.readFailed'); }
  }
  const summary = observation?.summary;
  return <div className="page-stack">
    <div><h2>{t('earnings.title')}</h2><p>{t('earnings.description')}</p></div>
    {error && <div className="card stack" role="alert"><p>{error}</p><Link href={path} className="btn secondary" prefetch={false}>{t('earnings.reloadChoices')}</Link></div>}
    {accounts && accounts.length === 0 && <div className="card stack"><h3>{t('earnings.noConnectedTitle')}</h3>
      <p>{t('earnings.noConnectedDescription')}</p>
      {role !== 'model' && <Link href={`/models/${encodeURIComponent(id)}`} className="btn secondary">{t('earnings.openProfile')}</Link>}
    </div>}
    {accounts && accounts.length > 0 && <form action={path} method="get" className="card stack">
      <label htmlFor="earnings-account">{t('earnings.accountLabel')}</label>
      <select id="earnings-account" name="connectionId" required defaultValue={accounts.some(a => a.id === selected) ? selected : ''}>
        <option value="" disabled>{t('earnings.selectAccount')}</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select>
      <div className="action-row"><button type="submit" className="btn">{observation ? t('earnings.refresh') : t('earnings.load')}</button></div>
      <p>{t('earnings.freshData')}</p>
    </form>}
    {summary && observation && <>
      <div className="card stack"><h3>{t('earnings.readAmounts')}</h3>
        <p>{t('earnings.amountsDescription')}</p>
        <p>{t('earnings.rewardsNote')}</p>
        <p>{t('earnings.observedAt', { value: dateTime(observation.observedAt) })} {t('earnings.periodTimezone', { timezone: summary.period.timezone })}</p>
      </div>
      <div className="grid">
        {[
          { label: t('earnings.allTime'), ...summary.totals.allTime },
          { label: t('earnings.thisMonth'), ...summary.totals.thisMonth },
          { label: t('earnings.previousMonth'), gross: summary.totals.thisMonth.previousMonthGross, net: summary.totals.thisMonth.previousMonthNet },
        ].map(pair => <div className="card stack" key={pair.label}><h3>{pair.label}</h3><p>{t('earnings.gross')}: {money(pair.gross, locale)}</p><p>{t('earnings.netAfterFees')}: {money(pair.net, locale)}</p></div>)}
      </div>
      <div className="card stack"><h3>{t('earnings.monthChange')}</h3><p>{t('earnings.gross')}: {summary.totals.thisMonth.grossChangePercentage === null ? t('earnings.notComparable') : new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(summary.totals.thisMonth.grossChangePercentage / 100)}</p><p>{t('earnings.netAfterFees')}: {summary.totals.thisMonth.netChangePercentage === null ? t('earnings.notComparable') : new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(summary.totals.thisMonth.netChangePercentage / 100)}</p></div>
      <section className="stack"><h3>{t('earnings.bySource')}</h3><p>{t('earnings.providerPeriod', { start: summary.period.startDate ? dateTime(summary.period.startDate) : t('earnings.noBound'), end: summary.period.endDate ? dateTime(summary.period.endDate) : t('earnings.noBound') })}</p>
        <div className="grid">{Object.entries(summary.breakdownBySource).map(([key, amounts]) => <div className="card stack" key={key}><h4>{t(sourceKeys[key] ?? 'earnings.source.other')}</h4><p>{t('earnings.gross')}: {money(amounts.gross, locale)}</p><p>{t('earnings.netAfterFees')}: {money(amounts.net, locale)}</p></div>)}</div>
      </section>
      <details className="card stack"><summary>{t('earnings.timeline', { granularity: summary.period.granularity })}</summary>
        {summary.overTime.length === 0 ? <p>{t('earnings.noTimeline')}</p> : <div style={{ overflowX: 'auto' }}><table><caption>{t('earnings.timelineCaption')}</caption><thead><tr><th scope="col">{t('earnings.periodStart')}</th><th scope="col">{t('earnings.gross')}</th><th scope="col">{t('earnings.netAfterFees')}</th></tr></thead><tbody>
          {summary.overTime.map((row, index) => <tr key={`${row.periodStart}-${index}`}><th scope="row">{row.periodStart}</th><td>{money(row.gross, locale)}</td><td>{money(row.net, locale)}</td></tr>)}
        </tbody></table></div>}
      </details>
    </>}
  </div>;
}
