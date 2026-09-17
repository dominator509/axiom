import Link from 'next/link';
import { api, getSession, type EarningsObservation } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const change = (value: number | null) => value === null ? 'Not comparable (previous month was zero)' : `${value.toFixed(1)}%`;
const labels: Record<string, string> = { subs: 'Subscriptions', messages: 'Messages', posts: 'Posts', tips: 'Tips', referrals: 'Referrals', renewals: 'Renewals', other: 'Other' };

export default async function EarningsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connectionId?: string | string[] }>;
}) {
  const { id } = await params;
  const role = (await getSession())?.user?.role;
  if (!talentDestinationAllowed(role, 'earnings')) return <div className="card stack">
    <h2>Earnings access unavailable</h2><p>Your role does not include financial records.</p><Link href="/">Back to workspace</Link>
  </div>;
  const query = await searchParams;
  const selected = typeof query.connectionId === 'string' ? query.connectionId : '';
  const path = `/models/${encodeURIComponent(id)}/earnings`;
  let accounts: Array<{ id: string; displayName: string }> | null = null;
  let observation: EarningsObservation | null = null;
  let error: string | null = null;
  try { accounts = (await api.models.earningsAccounts(id)).data.accounts; }
  catch { error = 'Earnings accounts could not be loaded. Refresh this page or ask your workspace owner to check access.'; }
  if (accounts && selected) {
    if (!accounts.some(account => account.id === selected)) error = 'The selected account is no longer available. Choose a connected account below.';
    else try { observation = (await api.models.earnings(id, selected)).data; }
    catch { error = 'Earnings could not be read. Ask your workspace owner to check the Fanvue connection, insights permission and model network, then try again.'; }
  }
  const summary = observation?.summary;
  return <div className="page-stack">
    <div><h2>Earnings</h2><p>Read-only Fanvue earnings for this talent. Select an account to request its latest summary; nothing is posted or withdrawn.</p></div>
    {error && <div className="card stack" role="alert"><p>{error}</p><Link href={path} className="btn secondary" prefetch={false}>Reload account choices</Link></div>}
    {accounts && accounts.length === 0 && <div className="card stack"><h3>No connected Fanvue account</h3>
      <p>Earnings are unavailable, not zero. A workspace owner or manager must connect this talent’s Fanvue account.</p>
      {role !== 'model' && <Link href={`/models/${encodeURIComponent(id)}`} className="btn secondary">Open talent profile</Link>}
    </div>}
    {accounts && accounts.length > 0 && <form action={path} method="get" className="card stack">
      <label htmlFor="earnings-account">Fanvue account</label>
      <select id="earnings-account" name="connectionId" required defaultValue={accounts.some(a => a.id === selected) ? selected : ''}>
        <option value="" disabled>Select an account</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select>
      <div className="action-row"><button type="submit" className="btn">{observation ? 'Refresh earnings' : 'Load earnings'}</button></div>
      <p>Each load requests fresh provider data. There is no automatic polling.</p>
    </form>}
    {summary && observation && <>
      <div className="card stack"><h3>How to read these amounts</h3>
        <p>All amounts are USD. Gross is before Fanvue fees; net is after those fees. Neither subtracts refunds or chargebacks. These are not your withdrawable balance or confirmed payouts.</p>
        <p>Referral and other creator rewards may be included, even when no fan made a payment. Do not add the source breakdown to the totals.</p>
        <p>Observed at {observation.observedAt}. Month boundaries use {summary.period.timezone}.</p>
      </div>
      <div className="grid">
        {[
          { label: 'All time', ...summary.totals.allTime },
          { label: 'This month', ...summary.totals.thisMonth },
          { label: 'Previous month', gross: summary.totals.thisMonth.previousMonthGross, net: summary.totals.thisMonth.previousMonthNet },
        ].map(pair => <div className="card stack" key={pair.label}><h3>{pair.label}</h3><p>Gross: {money(pair.gross)}</p><p>Net after fees: {money(pair.net)}</p></div>)}
      </div>
      <div className="card stack"><h3>Month-over-month change</h3><p>Gross: {change(summary.totals.thisMonth.grossChangePercentage)}</p><p>Net: {change(summary.totals.thisMonth.netChangePercentage)}</p></div>
      <section className="stack"><h3>By source</h3><p>Provider-selected period: {summary.period.startDate ?? 'No start bound'} to {summary.period.endDate ?? 'No end bound'} (end exclusive).</p>
        <div className="grid">{Object.entries(summary.breakdownBySource).map(([key, amounts]) => <div className="card stack" key={key}><h4>{labels[key] ?? key}</h4><p>Gross: {money(amounts.gross)}</p><p>Net: {money(amounts.net)}</p></div>)}</div>
      </section>
      <details className="card stack"><summary>Earnings over time ({summary.period.granularity} buckets)</summary>
        {summary.overTime.length === 0 ? <p>No timeline observations returned by Fanvue.</p> : <div style={{ overflowX: 'auto' }}><table><caption>Provider earnings timeline in USD</caption><thead><tr><th scope="col">Period start</th><th scope="col">Gross</th><th scope="col">Net after fees</th></tr></thead><tbody>
          {summary.overTime.map((row, index) => <tr key={`${row.periodStart}-${index}`}><th scope="row">{row.periodStart}</th><td>{money(row.gross)}</td><td>{money(row.net)}</td></tr>)}
        </tbody></table></div>}
      </details>
    </>}
  </div>;
}
