import { api, getSession } from '@/lib/api';
import { formatNumber, type MessageKey } from '@axiom/core';
import CharacterLockEditor from '@/components/CharacterLockEditor';
import ProfileEditor from '@/components/ProfileEditor';
import LocalDateTime from '@/components/LocalDateTime';
import ModelLifecycleControls from '@/components/ModelLifecycleControls';
import ProviderCacheControls from '@/components/ProviderCacheControls';
import WatermarkPolicyControls from '@/components/WatermarkPolicyControls';
import { absentCacheControl, CACHE_CONTROL_PROVIDER_ORDER } from '@/lib/cache-controls';
import { absentWatermarkPolicy } from '@/lib/watermark-policy';
import Link from 'next/link';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function ModelOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t, dateTime } = await getServerLocale();
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const canViewCacheControls = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const canEditCacheControls = ['owner', 'manager'].includes(session?.user?.role ?? '');
  const canViewWatermark = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const canEditWatermark = ['owner', 'manager'].includes(session?.user?.role ?? '');
  const allowed = (section: string) => talentDestinationAllowed(session?.user?.role, section);
  const toolLinks: Array<[string, MessageKey]> = [
    ['media', 'media.title'], ['consent', 'model.toolConsent'], ['linkbio', 'model.toolLinkBio'],
    ['analytics', 'analytics.title'], ['playbook', 'playbook.title'], ['roleplay', 'roleplay.title'], ['relay', 'relay.title'],
    ['agents', 'agent.accessTitle'], ['cascades', 'cascades.title'], ['triggers', 'automation.title'],
  ];
  const tools = toolLinks.filter(([section]) => allowed(section));
  let model;
  let network;
  let calendarCount: number | null = null;
  let fanCount: number | null = null;
  let networkFailed = false;
  let cacheControls = CACHE_CONTROL_PROVIDER_ORDER.map(absentCacheControl);
  let watermarkPolicy = absentWatermarkPolicy();
  try {
    model = (await api.models.get(id)).data;
  } catch {
    model = null;
  }
  if (model && allowed('network')) try {
    network = (await api.models.network(id)).data;
  } catch {
    network = null;
    networkFailed = true;
  }
  if (model && allowed('calendar')) try {
    calendarCount = (await api.models.calendar(id)).data.length;
  } catch {
    calendarCount = null;
  }
  if (model && allowed('fans')) try {
    fanCount = (await api.models.fans(id)).data.length;
  } catch {
    fanCount = null;
  }
  if (model && canViewCacheControls) try {
    const fetched = (await api.cacheControls.get(id)).data?.controls;
    if (Array.isArray(fetched) && fetched.length > 0) cacheControls = fetched;
  } catch {
    cacheControls = CACHE_CONTROL_PROVIDER_ORDER.map(absentCacheControl);
  }
  if (model && canViewWatermark) try {
    const fetched = (await api.watermarkPolicy.get(id)).data?.policy;
    if (fetched && typeof fetched === 'object') watermarkPolicy = fetched;
  } catch {
    watermarkPolicy = absentWatermarkPolicy();
  }

  if (!model) return <div className="card stack" role="alert">
    <h2>{t('model.profileUnavailable')}</h2>
    <p>{t('model.profileUnavailableDescription')}</p>
    <Link href="/" className="btn secondary">{t('model.backToTalent')}</Link>
  </div>;

  return (
    <div className="grid">
      <div className="card stack">
        <h3>{t('model.profile')}</h3>
        <div><strong>{t('model.creator')}:</strong> {model.displayName}</div>
        <div>
          <strong>{t('model.handle')}:</strong> @{model.handle}
        </div>
        <div>
          <strong>{t('model.bio')}:</strong> {model.bio ?? '—'}
        </div>
        {canEdit && <ProfileEditor key={`${model.id}:${model.updatedAt}`} model={model} />}
        {canEdit && <ModelLifecycleControls model={model} canEdit={canEdit} />}
        {canEdit && (typeof model.characterLockPrompt === 'string' && Number.isSafeInteger(model.characterLockVersion)
          ? <CharacterLockEditor key={`${model.id}:${model.characterLockVersion}`} modelId={model.id}
            initialPrompt={model.characterLockPrompt} initialVersion={model.characterLockVersion!} />
          : <p>{t('model.characterLockUnavailable')}</p>)}
        {!canEdit && <p className="subtle">{t('model.profileEditRequires')}</p>}
        <div>
          <strong>{t('model.created')}:</strong> <LocalDateTime value={model.createdAt} fallback={dateTime(model.createdAt)} />
        </div>
      </div>
      {allowed('network') && <div className="card stack">
        <h3>{t('model.networkSecurity')}</h3>
        {network ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t('model.egress')}</span>
              <span className="mono">{network.egressMode}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t('model.health')}</span>
              {network.healthy ? (
                <span className="badge good">{t('model.healthy')}</span>
              ) : (
                <span className="badge bad">{t('model.degraded')}</span>
              )}
            </div>
            {network.latencyMs != null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{t('model.latency')}</span>
                <span>{formatNumber(network.latencyMs, locale)} ms</span>
              </div>
            )}
            {network.lastEgressIp && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{t('model.egressIp')}</span>
                <span className="mono">{network.lastEgressIp}</span>
              </div>
            )}
            {network.lastError && <div style={{ color: 'var(--bad)' }}>{t('model.networkStatusFailed')}</div>}
          </>
        ) : (
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {networkFailed ? t('model.networkStatusFailed') : t('model.noNetworkConfiguration')}
          </p>
        )}
        <Link href={`/models/${id}/network`} className="btn secondary">{t('model.openNetworkSettings')}</Link>
      </div>}
      {(allowed('calendar') || allowed('fans') || allowed('generation') || allowed('approvals')) && <div className="card stack">
        <h3>{t('model.activity')}</h3>
        {allowed('calendar') && <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/models/${id}/calendar`}>{t('model.viewSchedule')}</Link>
          <strong>{calendarCount ?? t('model.unavailable')}</strong>
        </div>}
        {allowed('fans') && <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/models/${id}/fans`}>{t('model.viewFanContacts')}</Link>
          <strong>{fanCount ?? t('model.unavailable')}</strong>
        </div>}
        <p className="subtle">{t('model.countsDescription')}</p>
        {allowed('generation') && <Link href={`/models/${id}/generation`} className="btn">{t('model.createContent')}</Link>}
        {allowed('approvals') && <Link href={`/models/${id}/approvals`} className="btn secondary">{t('model.reviewContent')}</Link>}
      </div>}
      {canViewCacheControls && <ProviderCacheControls modelId={model.id} initialControls={cacheControls} canEdit={canEditCacheControls} />}
      {canViewWatermark && <WatermarkPolicyControls modelId={model.id} initialPolicy={watermarkPolicy} canEdit={canEditWatermark} />}
      {tools.length > 0 && <div className="card stack">
        <h3>{t('model.workspaceTools')}</h3>
        <p className="subtle">{t('model.workspaceToolsDescription')}</p>
        <div className="grid" style={{ gap: 10 }}>
          {tools.map(([section, label]) => <Link key={section} href={`/models/${id}/${section}`} className="btn secondary">{t(label)}</Link>)}
        </div>
      </div>}
    </div>
  );
}
