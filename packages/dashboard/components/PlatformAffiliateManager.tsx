'use client';

import { useRef, useState } from 'react';
import * as React from 'react';
import { CATALOGS, formatNumber, LocaleCatalog, type SupportedLocale } from '@axiom/core';
import type {
  AffiliateCampaign,
  AffiliateCampaignReport,
  AffiliateHold,
  AffiliatePartner,
  AffiliateProgramSnapshot,
} from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const fallbackCatalog = new LocaleCatalog(CATALOGS);
const englishT = (key: string, values?: Record<string, string | number>) => fallbackCatalog.t('en', key, values);

function hasReactDispatcher(): boolean {
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

function useAffiliateLocale(): { locale: SupportedLocale; t: (key: string, values?: Record<string, string | number>) => string } {
  if (hasReactDispatcher()) {
    const { locale, t } = useLocale();
    return { locale, t };
  }
  return { locale: 'en', t: englishT };
}

function money(cents: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatAffiliateDate(value: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function referralPath(referralToken: string): string {
  return `/affiliate/r/${encodeURIComponent(referralToken)}`;
}

function statusClass(status: string): string {
  if (['active', 'resolved', 'approved'].includes(status)) return 'badge good';
  if (['suspended', 'revoked', 'open'].includes(status)) return 'badge bad';
  return 'badge mute';
}

function statusLabel(status: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  return t(`affiliate.status.${status}`);
}

const holdReasonFallback: Record<string, string> = {
  fraud_suspected: 'Suspected fraud',
  chargeback: 'Chargeback',
  self_referral: 'Self-referral',
  terms_violation: 'Terms violation',
};

function holdReasonLabel(reason: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const key = `affiliate.holdReason.${reason}`;
  const translated = t(key);
  return !translated || translated === key ? holdReasonFallback[reason] ?? reason : translated;
}

interface Props { initial: AffiliateProgramSnapshot }

type AffiliateMutationIntent = {
  path: string;
  method: 'POST' | 'PATCH';
  body: string;
  key: string;
  success: string;
  onConfirmed?: () => void;
};

export default function PlatformAffiliateManager({ initial }: Props) {
  const { locale, t } = useAffiliateLocale();
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
  const intent = useRef<AffiliateMutationIntent | null>(null);
  const [pendingIntent, setPendingIntent] = useState<AffiliateMutationIntent | null>(null);

  async function refresh(): Promise<void> {
    const response = await fetch('/api/v1/platform/affiliate/program', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(t('affiliate.loadFailed'));
    const result = await readDashboardJson<{ data: AffiliateProgramSnapshot }>(response);
    setSnapshot(result.data);
    setPartnerId(current => result.data.partners.some(partner => partner.id === current)
      ? current
      : result.data.partners.find(partner => partner.status === 'active')?.id ?? '');
  }

  async function executeMutation(request: AffiliateMutationIntent): Promise<boolean> {
    setBusy(request.path); setMessage(''); setError('');
    try {
      const response = await mutationFetch(request.path, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: request.body,
      }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        setError(details?.error?.message ?? t('affiliate.requestUnconfirmed', { status: response.status }));
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setPendingIntent(null);
        }
        return false;
      }
      await readDashboardJson(response);
      intent.current = null;
      setPendingIntent(null);
      request.onConfirmed?.();
      setMessage(request.success);
      try {
        await refresh();
      } catch {
        // The mutation response is authoritative. Keep its success message and
        // report the separate readback failure without offering a duplicate POST.
        setError(t('affiliate.loadFailed'));
      }
      return true;
    } catch {
      setError(t('affiliate.retrySame'));
      return false;
    } finally {
      setBusy('');
    }
  }

  async function mutate(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, success: string, onConfirmed?: () => void): Promise<boolean> {
    if (busy || intent.current) return false;
    const request: AffiliateMutationIntent = {
      path,
      method,
      body: JSON.stringify(body),
      key: createIdempotencyKey(),
      success,
      onConfirmed,
    };
    intent.current = request;
    setPendingIntent(request);
    return executeMutation(request);
  }

  function retryPendingMutation(): void {
    const request = intent.current;
    if (!busy && request) void executeMutation(request);
  }

  async function createPartner(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await mutate('/api/v1/platform/affiliate/partners', 'POST', {
      displayName: displayName.trim(),
      email: email.trim(),
      termsVersion: termsVersion.trim(),
      status: partnerStatus,
      disclosureAccepted,
    }, t('affiliate.partnerCreated'), () => {
      setDisplayName(''); setEmail(''); setPartnerStatus('invited'); setDisclosureAccepted(false);
    });
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await mutate('/api/v1/platform/affiliate/campaigns', 'POST', {
      partnerId,
      name: campaignName.trim(),
      slug: campaignSlug.trim().toLowerCase(),
      status: campaignStatus,
      commissionBps: Number(commissionBps),
    }, t('affiliate.campaignCreated'), () => { setCampaignName(''); setCampaignSlug(''); setCampaignStatus('draft'); });
  }

  async function updatePartner(partner: AffiliatePartner, status: AffiliatePartner['status']): Promise<void> {
    await mutate(`/api/v1/platform/affiliate/partners/${encodeURIComponent(partner.id)}`, 'PATCH', {
      status,
      ...(status === 'active' ? { disclosureAccepted: true } : {}),
    }, t('affiliate.statusChanged', { status: statusLabel(status, t) }));
  }

  async function resolveHold(hold: AffiliateHold, resolution: 'released' | 'upheld'): Promise<void> {
    await mutate(`/api/v1/platform/affiliate/holds/${encodeURIComponent(hold.id)}/resolve`, 'POST', { resolution }, t('affiliate.holdResolved', { status: statusLabel(resolution, t) }));
  }

  async function loadReport(campaign: AffiliateCampaign): Promise<void> {
    setBusy(`report:${campaign.id}`); setMessage(''); setError('');
    try {
      const response = await fetch(`/api/v1/platform/affiliate/campaigns/${encodeURIComponent(campaign.id)}/report`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(t('affiliate.reportLoadFailed'));
      const result = await readDashboardJson<{ data: AffiliateCampaignReport }>(response);
      setReport(result.data);
    } catch {
      setError(t('affiliate.reportLoadFailed'));
    } finally {
      setBusy('');
    }
  }

  async function copyReferralLink(referralToken: string): Promise<void> {
    setMessage(''); setError('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      const link = new URL(referralPath(referralToken), window.location.origin).toString();
      await navigator.clipboard.writeText(link);
      setMessage(t('affiliate.referralCopied'));
    } catch {
      setError(t('affiliate.copyUnavailable'));
    }
  }

  const activePartners = snapshot.partners.filter(partner => partner.status === 'active' && partner.disclosureAcceptedAt);
  const openHolds = snapshot.holds.filter(hold => hold.state === 'open');

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">{t('affiliate.eyebrow')}</p>
          <h1>{t('affiliate.title')}</h1>
          <p className="page-intro">{t('affiliate.description')}</p>
        </div>
        <span className={statusClass(snapshot.program.status)}><i />{statusLabel(snapshot.program.status, t)}</span>
      </section>
      {pendingIntent && <section className="card row" role="alert" aria-live="assertive">
        <p className="subtle" style={{ flex: 1, margin: 0 }}>{t('affiliate.retrySame')}</p>
        <button className="btn secondary" type="button" disabled={!!busy} onClick={retryPendingMutation}>
          {busy === pendingIntent.path ? t('status.loading') : t('affiliate.retryPending')}
        </button>
      </section>}

      <section className="stat-grid" aria-label={t('affiliate.summaryAria')}>
        <div className="stat-card"><small>{t('affiliate.partners')}</small><strong>{formatNumber(snapshot.summary.partners, locale)}</strong><span>{t('affiliate.activeDisclosure', { count: formatNumber(activePartners.length, locale) })}</span></div>
        <div className="stat-card"><small>{t('affiliate.campaigns')}</small><strong>{formatNumber(snapshot.summary.campaigns, locale)}</strong><span>{t('affiliate.attributionEvents', { count: formatNumber(snapshot.summary.attributionEvents, locale) })}</span></div>
        <div className="stat-card accent"><small>{t('affiliate.accruedCommission')}</small><strong>{money(snapshot.summary.accruedCents, locale)}</strong><span>{t('affiliate.openHolds', { count: formatNumber(snapshot.summary.openHolds, locale) })}</span></div>
      </section>

      <section className="card stack" aria-labelledby="affiliate-billing-heading">
        <h2 id="affiliate-billing-heading">{t('affiliate.billingHeading')}</h2>
        <p className="subtle">{t('affiliate.billingDescription')}</p>
        <p><strong>{t('affiliate.billingEndpoint')}:</strong> <code>{snapshot.billingWebhook.endpoint}</code></p>
        <p className="mono">{snapshot.billingWebhook.signatureHeader}: t=&lt;unix-seconds&gt;,v1=&lt;sha256-hex&gt;</p>
        <span className={`badge ${snapshot.billingWebhook.configured ? 'good' : 'warn'}`}>
          {snapshot.billingWebhook.configured ? t('affiliate.billingConfigured') : t('affiliate.billingMissing')}
        </span>
      </section>

      <div className="grid">
        <form className="card stack" aria-label={t('affiliate.createPartner')} onSubmit={event => { void createPartner(event); }}>
          <fieldset className="stack" disabled={!!busy || pendingIntent !== null} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
          <div><p className="eyebrow">{t('affiliate.partnerOnboarding')}</p><h2>{t('affiliate.invitePartner')}</h2></div>
          <label>{t('affiliate.displayName')}<input name="displayName" required maxLength={160} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder={t('affiliate.displayName')} /></label>
          <label>{t('affiliate.email')}<input name="email" required type="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder={t('affiliate.email')} /></label>
          <label>{t('affiliate.termsVersion')}<input name="termsVersion" required maxLength={80} value={termsVersion} onChange={event => setTermsVersion(event.target.value)} /></label>
          <label>{t('affiliate.status')}<select name="partnerStatus" value={partnerStatus} onChange={event => setPartnerStatus(event.target.value as 'invited' | 'active')}><option value="invited">{t('affiliate.invited')}</option><option value="active">{t('affiliate.activeNow')}</option></select></label>
          <label className="checkbox-option"><input name="disclosureAccepted" type="checkbox" checked={disclosureAccepted} onChange={event => setDisclosureAccepted(event.target.checked)} /><span>{t('affiliate.disclosureAcceptance')}</span></label>
          {partnerStatus === 'active' && !disclosureAccepted && <p className="subtle">{t('affiliate.activeRequiresDisclosure')}</p>}
          <button className="btn" type="submit" disabled={!!busy || (partnerStatus === 'active' && !disclosureAccepted)}>{t('affiliate.createPartner')}</button>
          </fieldset>
        </form>

        <form className="card stack" aria-label={t('affiliate.createCampaign')} onSubmit={event => { void createCampaign(event); }}>
          <fieldset className="stack" disabled={!!busy || pendingIntent !== null} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
          <div><p className="eyebrow">{t('affiliate.attributionSetup')}</p><h2>{t('affiliate.createCampaign')}</h2></div>
          <label>{t('affiliate.activePartner')}<select name="partnerId" required value={partnerId} onChange={event => setPartnerId(event.target.value)}><option value="">{t('affiliate.selectDisclosedPartner')}</option>{activePartners.map(partner => <option key={partner.id} value={partner.id}>{partner.displayName} · {partner.email}</option>)}</select></label>
          <label>{t('affiliate.campaignName')}<input name="campaignName" required maxLength={160} value={campaignName} onChange={event => setCampaignName(event.target.value)} placeholder={t('affiliate.campaignName')} /></label>
          <label>{t('affiliate.slug')}<input name="campaignSlug" required pattern="[a-z0-9][a-z0-9-]{0,63}" maxLength={64} value={campaignSlug} onChange={event => setCampaignSlug(event.target.value)} placeholder={t('affiliate.slug')} /></label>
          <div className="grid">
            <label>{t('affiliate.commissionBps')}<input name="commissionBps" required type="number" min="0" max="10000" value={commissionBps} onChange={event => setCommissionBps(event.target.value)} /></label>
            <label>{t('affiliate.state')}<select name="campaignStatus" value={campaignStatus} onChange={event => setCampaignStatus(event.target.value as 'draft' | 'active')}><option value="draft">{t('affiliate.draft')}</option><option value="active">{t('affiliate.active')}</option></select></label>
          </div>
          <p className="subtle">{t('affiliate.defaultRate', { rate: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(snapshot.program.defaultCommissionBps / 100) })}</p>
          <button className="btn" type="submit" disabled={!!busy || !partnerId}>{t('affiliate.createCampaign')}</button>
          </fieldset>
        </form>
      </div>

      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}

      <section className="card stack" aria-labelledby="partners-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}><div><p className="eyebrow">{t('affiliate.partnerLedger')}</p><h2 id="partners-heading">{t('affiliate.referralPartners')}</h2></div><span className="subtle">{t('affiliate.terms', { version: snapshot.program.termsVersion })}</span></div>
        {snapshot.partners.length === 0 ? <p className="subtle">{t('affiliate.noPartners')}</p> : <table><caption className="sr-only">{t('affiliate.partnerTable')}</caption><thead><tr><th>{t('affiliate.name')}</th><th>{t('affiliate.status')}</th><th>{t('affiliate.termsVersion')}</th><th>{t('affiliate.actions')}</th></tr></thead><tbody>{snapshot.partners.map(partner => <tr key={partner.id}><td><strong>{partner.displayName}</strong><br /><span className="subtle">{partner.email}</span></td><td><span className={statusClass(partner.status)}><i />{statusLabel(partner.status, t)}</span></td><td>{partner.termsVersion ?? '—'}<br /><span className="subtle">{partner.disclosureAcceptedAt ? t('affiliate.disclosureRecorded') : t('affiliate.disclosurePending')}</span></td><td><div className="action-row">{partner.status === 'invited' && <button className="btn secondary" type="button" disabled={!!busy || pendingIntent !== null} onClick={() => void updatePartner(partner, 'active')}>{t('affiliate.activate')}</button>}{partner.status === 'active' && <button className="btn secondary" type="button" disabled={!!busy || pendingIntent !== null} onClick={() => void updatePartner(partner, 'suspended')}>{t('affiliate.suspend')}</button>}{partner.status === 'suspended' && <button className="btn secondary" type="button" disabled={!!busy || pendingIntent !== null} onClick={() => void updatePartner(partner, 'active')}>{t('affiliate.reactivate')}</button>}{(partner.status === 'active' || partner.status === 'suspended') && <a className="btn secondary" href={`/api/v1/platform/affiliate/payouts/export?partnerId=${encodeURIComponent(partner.id)}`}>{t('affiliate.payoutCsv')}</a>}</div></td></tr>)}</tbody></table>}
      </section>

      <section className="card stack" aria-labelledby="campaigns-heading">
        <div><p className="eyebrow">{t('affiliate.referralLinks')}</p><h2 id="campaigns-heading">{t('affiliate.campaignsHeading')}</h2></div>
        {snapshot.campaigns.length === 0 ? <p className="subtle">{t('affiliate.noCampaigns')}</p> : <table><caption className="sr-only">{t('affiliate.campaignTable')}</caption><thead><tr><th>{t('affiliate.campaign')}</th><th>{t('affiliate.partner')}</th><th>{t('affiliate.commission')}</th><th>{t('affiliate.referralLink')}</th><th>{t('affiliate.actions')}</th></tr></thead><tbody>{snapshot.campaigns.map(campaign => { const partner = snapshot.partners.find(item => item.id === campaign.partnerId); const link = referralPath(campaign.referralToken); return <tr key={campaign.id}><td><strong>{campaign.name}</strong><br /><span className="subtle">/{campaign.slug} · {statusLabel(campaign.status, t)}</span></td><td>{partner?.displayName ?? shortId(campaign.partnerId)}</td><td>{new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(campaign.commissionBps / 100)}%</td><td><a className="mono" href={link} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">{link}</a><br /><button className="btn secondary" type="button" onClick={() => void copyReferralLink(campaign.referralToken)}>{t('affiliate.copyReferralLink')}</button></td><td><button className="btn secondary" type="button" disabled={!!busy || pendingIntent !== null} onClick={() => void loadReport(campaign)}>{busy === `report:${campaign.id}` ? t('status.loading') : t('affiliate.viewReport')}</button></td></tr>; })}</tbody></table>}
        {report && <div className="card stack" aria-live="polite"><div className="row" style={{ justifyContent: 'space-between' }}><h3>{t('affiliate.reportTitle', { name: report.campaign.name })}</h3><span className={statusClass(report.campaign.status)}><i />{statusLabel(report.campaign.status, t)}</span></div><div className="stat-grid"><div className="stat-card"><small>{t('affiliate.clicksVisits')}</small><strong>{formatNumber(report.attribution.clicks, locale)} / {formatNumber(report.attribution.visits, locale)}</strong><span>{t('affiliate.identityStitches', { count: formatNumber(report.attribution.identityStitches, locale) })}</span></div><div className="stat-card"><small>{t('affiliate.conversions')}</small><strong>{formatNumber(report.conversions, locale)}</strong><span>{t('affiliate.attributedSignups')}</span></div><div className="stat-card accent"><small>{t('affiliate.exportable')}</small><strong>{money(report.commissions.exportableCents, locale)}</strong><span>{report.commissions.openHold ? t('affiliate.blockedOpenHold') : t('affiliate.noOpenHold')}</span></div></div></div>}
      </section>

      <section className="card stack" aria-labelledby="holds-heading">
        <div><p className="eyebrow">{t('affiliate.riskReview')}</p><h2 id="holds-heading">{t('affiliate.holdsTitle')}</h2><p className="subtle">{t('affiliate.holdDescription')}</p></div>
        {openHolds.length === 0 ? <p className="subtle">{t('affiliate.noOpenHolds')}</p> : <table><caption className="sr-only">{t('affiliate.holdsTitle')}</caption><thead><tr><th>{t('affiliate.partner')}</th><th>{t('affiliate.reason')}</th><th>{t('affiliate.opened')}</th><th>{t('affiliate.decision')}</th></tr></thead><tbody>{openHolds.map(hold => <tr key={hold.id}><td>{snapshot.partners.find(partner => partner.id === hold.partnerId)?.displayName ?? shortId(hold.partnerId)}</td><td><span className="badge bad"><i />{holdReasonLabel(hold.reason, t)}</span></td><td>{formatAffiliateDate(hold.createdAt, locale)}</td><td><div className="action-row"><button className="btn secondary" type="button" disabled={!!busy || pendingIntent !== null} onClick={() => void resolveHold(hold, 'released')}>{t('affiliate.release')}</button><button className="btn danger" type="button" disabled={!!busy || pendingIntent !== null} onClick={() => void resolveHold(hold, 'upheld')}>{t('affiliate.uphold')}</button></div></td></tr>)}</tbody></table>}
      </section>
    </div>
  );
}
