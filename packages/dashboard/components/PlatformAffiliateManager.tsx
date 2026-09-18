'use client';

import { useState } from 'react';
import type {
  AffiliateCampaign,
  AffiliateCampaignReport,
  AffiliateHold,
  AffiliatePartner,
  AffiliateProgramSnapshot,
} from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function statusClass(status: string): string {
  if (['active', 'resolved', 'approved'].includes(status)) return 'badge good';
  if (['suspended', 'revoked', 'open'].includes(status)) return 'badge bad';
  return 'badge mute';
}

interface Props { initial: AffiliateProgramSnapshot }

export default function PlatformAffiliateManager({ initial }: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [termsVersion, setTermsVersion] = useState(initial.program.termsVersion);
  const [partnerStatus, setPartnerStatus] = useState<'invited' | 'active'>('invited');
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [partnerId, setPartnerId] = useState(initial.partners.find(partner => partner.status === 'active')?.id ?? '');
  const [campaignName, setCampaignName] = useState('');
  const [campaignSlug, setCampaignSlug] = useState('');
  const [commissionBps, setCommissionBps] = useState(String(initial.program.defaultCommissionBps));
  const [campaignStatus, setCampaignStatus] = useState<'draft' | 'active'>('draft');
  const [report, setReport] = useState<AffiliateCampaignReport | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh(): Promise<void> {
    const response = await fetch('/api/v1/platform/affiliate/program', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('program refresh failed');
    const result = await readDashboardJson<{ data: AffiliateProgramSnapshot }>(response);
    setSnapshot(result.data);
    setPartnerId(current => result.data.partners.some(partner => partner.id === current)
      ? current
      : result.data.partners.find(partner => partner.status === 'active')?.id ?? '');
  }

  async function mutate(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(path); setMessage(''); setError('');
    try {
      const response = await mutationFetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        setError(details?.error?.message ?? `Request was not confirmed (HTTP ${response.status}).`);
        return false;
      }
      await readDashboardJson(response);
      await refresh();
      setMessage(success);
      return true;
    } catch {
      setError('The change was not confirmed. Retry the same action.');
      return false;
    } finally {
      setBusy('');
    }
  }

  async function createPartner(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const saved = await mutate('/api/v1/platform/affiliate/partners', 'POST', {
      displayName: displayName.trim(),
      email: email.trim(),
      termsVersion: termsVersion.trim(),
      status: partnerStatus,
      disclosureAccepted,
    }, 'Partner created.');
    if (saved) {
      setDisplayName(''); setEmail(''); setPartnerStatus('invited'); setDisclosureAccepted(false);
    }
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const saved = await mutate('/api/v1/platform/affiliate/campaigns', 'POST', {
      partnerId,
      name: campaignName.trim(),
      slug: campaignSlug.trim().toLowerCase(),
      status: campaignStatus,
      commissionBps: Number(commissionBps),
    }, 'Campaign created.');
    if (saved) { setCampaignName(''); setCampaignSlug(''); setCampaignStatus('draft'); }
  }

  async function updatePartner(partner: AffiliatePartner, status: AffiliatePartner['status']): Promise<void> {
    await mutate(`/api/v1/platform/affiliate/partners/${encodeURIComponent(partner.id)}`, 'PATCH', {
      status,
      ...(status === 'active' ? { disclosureAccepted: true } : {}),
    }, `Partner ${status}.`);
  }

  async function resolveHold(hold: AffiliateHold, resolution: 'released' | 'upheld'): Promise<void> {
    await mutate(`/api/v1/platform/affiliate/holds/${encodeURIComponent(hold.id)}/resolve`, 'POST', { resolution }, `Hold ${resolution}.`);
  }

  async function loadReport(campaign: AffiliateCampaign): Promise<void> {
    setBusy(`report:${campaign.id}`); setMessage(''); setError('');
    try {
      const response = await fetch(`/api/v1/platform/affiliate/campaigns/${encodeURIComponent(campaign.id)}/report`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('report failed');
      const result = await readDashboardJson<{ data: AffiliateCampaignReport }>(response);
      setReport(result.data);
    } catch {
      setError('Campaign report could not be loaded.');
    } finally {
      setBusy('');
    }
  }

  const activePartners = snapshot.partners.filter(partner => partner.status === 'active' && partner.disclosureAcceptedAt);
  const openHolds = snapshot.holds.filter(hold => hold.state === 'open');

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Platform acquisition</p>
          <h1>Affiliate program</h1>
          <p className="page-intro">Manage partners who refer creators to FanThynks. This is the FanThynks SaaS referral program; it does not expose tenant data or create creator-facing resale controls.</p>
        </div>
        <span className={statusClass(snapshot.program.status)}><i />{snapshot.program.status}</span>
      </section>

      <section className="stat-grid" aria-label="Affiliate program summary">
        <div className="stat-card"><small>Partners</small><strong>{snapshot.summary.partners}</strong><span>{activePartners.length} active with disclosure</span></div>
        <div className="stat-card"><small>Campaigns</small><strong>{snapshot.summary.campaigns}</strong><span>{snapshot.summary.attributionEvents} attribution events</span></div>
        <div className="stat-card accent"><small>Accrued commission</small><strong>{money(snapshot.summary.accruedCents)}</strong><span>{snapshot.summary.openHolds} open fraud/chargeback holds</span></div>
      </section>

      <div className="grid">
        <form className="card stack" aria-label="Create affiliate partner" onSubmit={event => { void createPartner(event); }}>
          <div><p className="eyebrow">Partner onboarding</p><h2>Invite a referral partner</h2></div>
          <label>Display name<input name="displayName" required maxLength={160} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Creator community or agency" /></label>
          <label>Email<input name="email" required type="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder="partner@example.com" /></label>
          <label>Terms version<input name="termsVersion" required maxLength={80} value={termsVersion} onChange={event => setTermsVersion(event.target.value)} /></label>
          <label>Status<select name="partnerStatus" value={partnerStatus} onChange={event => setPartnerStatus(event.target.value as 'invited' | 'active')}><option value="invited">Invited</option><option value="active">Active now</option></select></label>
          <label className="checkbox-option"><input name="disclosureAccepted" type="checkbox" checked={disclosureAccepted} onChange={event => setDisclosureAccepted(event.target.checked)} /><span>I recorded the partner’s disclosure and referral terms acceptance.</span></label>
          {partnerStatus === 'active' && !disclosureAccepted && <p className="subtle">An active partner requires disclosure acceptance. Leave the partner invited if acceptance is still pending.</p>}
          <button className="btn" type="submit" disabled={!!busy || (partnerStatus === 'active' && !disclosureAccepted)}>Create partner</button>
        </form>

        <form className="card stack" aria-label="Create affiliate campaign" onSubmit={event => { void createCampaign(event); }}>
          <div><p className="eyebrow">Attribution setup</p><h2>Create a campaign</h2></div>
          <label>Active partner<select name="partnerId" required value={partnerId} onChange={event => setPartnerId(event.target.value)}><option value="">Select a disclosed partner</option>{activePartners.map(partner => <option key={partner.id} value={partner.id}>{partner.displayName} · {partner.email}</option>)}</select></label>
          <label>Campaign name<input name="campaignName" required maxLength={160} value={campaignName} onChange={event => setCampaignName(event.target.value)} placeholder="Launch referral" /></label>
          <label>Slug<input name="campaignSlug" required pattern="[a-z0-9][a-z0-9-]{0,63}" maxLength={64} value={campaignSlug} onChange={event => setCampaignSlug(event.target.value)} placeholder="launch-referral" /></label>
          <div className="grid">
            <label>Commission (bps)<input name="commissionBps" required type="number" min="0" max="10000" value={commissionBps} onChange={event => setCommissionBps(event.target.value)} /></label>
            <label>State<select name="campaignStatus" value={campaignStatus} onChange={event => setCampaignStatus(event.target.value as 'draft' | 'active')}><option value="draft">Draft</option><option value="active">Active</option></select></label>
          </div>
          <p className="subtle">The seeded program default is {(snapshot.program.defaultCommissionBps / 100).toFixed(2)}%. Active campaigns require an active partner with disclosure recorded.</p>
          <button className="btn" type="submit" disabled={!!busy || !partnerId}>Create campaign</button>
        </form>
      </div>

      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}

      <section className="card stack" aria-labelledby="partners-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}><div><p className="eyebrow">Partner ledger</p><h2 id="partners-heading">Referral partners</h2></div><span className="subtle">Terms {snapshot.program.termsVersion}</span></div>
        {snapshot.partners.length === 0 ? <p className="subtle">No partners have been invited yet.</p> : <table><caption className="sr-only">FanThynks affiliate referral partners</caption><thead><tr><th>Name</th><th>Status</th><th>Terms</th><th>Actions</th></tr></thead><tbody>{snapshot.partners.map(partner => <tr key={partner.id}><td><strong>{partner.displayName}</strong><br /><span className="subtle">{partner.email}</span></td><td><span className={statusClass(partner.status)}><i />{partner.status}</span></td><td>{partner.termsVersion ?? '—'}<br /><span className="subtle">{partner.disclosureAcceptedAt ? 'Disclosure recorded' : 'Disclosure pending'}</span></td><td><div className="action-row">{partner.status === 'invited' && <button className="btn secondary" type="button" disabled={!!busy} onClick={() => void updatePartner(partner, 'active')}>Activate</button>}{partner.status === 'active' && <button className="btn secondary" type="button" disabled={!!busy} onClick={() => void updatePartner(partner, 'suspended')}>Suspend</button>}{partner.status === 'suspended' && <button className="btn secondary" type="button" disabled={!!busy} onClick={() => void updatePartner(partner, 'active')}>Reactivate</button>}{(partner.status === 'active' || partner.status === 'suspended') && <a className="btn secondary" href={`/api/v1/platform/affiliate/payouts/export?partnerId=${encodeURIComponent(partner.id)}`}>Payout CSV</a>}</div></td></tr>)}</tbody></table>}
      </section>

      <section className="card stack" aria-labelledby="campaigns-heading">
        <div><p className="eyebrow">Referral links</p><h2 id="campaigns-heading">Campaigns</h2></div>
        {snapshot.campaigns.length === 0 ? <p className="subtle">Create a campaign after a partner accepts disclosure terms.</p> : <table><caption className="sr-only">FanThynks affiliate campaigns</caption><thead><tr><th>Campaign</th><th>Partner</th><th>Commission</th><th>Referral token</th><th>Actions</th></tr></thead><tbody>{snapshot.campaigns.map(campaign => { const partner = snapshot.partners.find(item => item.id === campaign.partnerId); return <tr key={campaign.id}><td><strong>{campaign.name}</strong><br /><span className="subtle">/{campaign.slug} · {campaign.status}</span></td><td>{partner?.displayName ?? shortId(campaign.partnerId)}</td><td>{(campaign.commissionBps / 100).toFixed(2)}%</td><td className="mono">{campaign.referralToken}</td><td><button className="btn secondary" type="button" disabled={!!busy} onClick={() => void loadReport(campaign)}>{busy === `report:${campaign.id}` ? 'Loading…' : 'View report'}</button></td></tr>; })}</tbody></table>}
        {report && <div className="card stack" aria-live="polite"><div className="row" style={{ justifyContent: 'space-between' }}><h3>{report.campaign.name} report</h3><span className={statusClass(report.campaign.status)}><i />{report.campaign.status}</span></div><div className="stat-grid"><div className="stat-card"><small>Clicks / visits</small><strong>{report.attribution.clicks} / {report.attribution.visits}</strong><span>{report.attribution.identityStitches} identity stitches</span></div><div className="stat-card"><small>Conversions</small><strong>{report.conversions}</strong><span>Attributed SaaS signups</span></div><div className="stat-card accent"><small>Exportable</small><strong>{money(report.commissions.exportableCents)}</strong><span>{report.commissions.openHold ? 'Blocked by open hold' : 'No open hold'}</span></div></div></div>}
      </section>

      <section className="card stack" aria-labelledby="holds-heading">
        <div><p className="eyebrow">Risk review</p><h2 id="holds-heading">Fraud and payout holds</h2><p className="subtle">Resolve only after the chargeback, self-referral, or terms review is complete. Resolving a hold creates an audit event.</p></div>
        {openHolds.length === 0 ? <p className="subtle">No open holds.</p> : <table><caption className="sr-only">Open FanThynks affiliate holds</caption><thead><tr><th>Partner</th><th>Reason</th><th>Opened</th><th>Decision</th></tr></thead><tbody>{openHolds.map(hold => <tr key={hold.id}><td>{snapshot.partners.find(partner => partner.id === hold.partnerId)?.displayName ?? shortId(hold.partnerId)}</td><td><span className="badge bad"><i />{hold.reason}</span></td><td>{new Date(hold.createdAt).toLocaleDateString()}</td><td><div className="action-row"><button className="btn secondary" type="button" disabled={!!busy} onClick={() => void resolveHold(hold, 'released')}>Release</button><button className="btn danger" type="button" disabled={!!busy} onClick={() => void resolveHold(hold, 'upheld')}>Uphold</button></div></td></tr>)}</tbody></table>}
      </section>
    </div>
  );
}
