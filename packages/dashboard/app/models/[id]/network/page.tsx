import { formatNumber } from '@axiom/core';
import { Fragment } from 'react';
import { api, getSession } from '@/lib/api';
import type { SocialConnection } from '@/lib/api';
import NetworkForm from '@/components/NetworkForm';
import EgressCredentials from '@/components/EgressCredentials';
import NetworkHealth from '@/components/NetworkHealth';
import ActivateNetwork from '@/components/ActivateNetwork';
import DisconnectSocialAccountButton from '@/components/DisconnectSocialAccountButton';
import SnapchatConnect from '@/components/SnapchatConnect';
import TelegramConnect from '@/components/TelegramConnect';
import DiscordBotConnect from '@/components/DiscordBotConnect';
import RefreshSocialAccountButton from '@/components/RefreshSocialAccountButton';
import ProviderOperationsPanel from '@/components/ProviderOperationsPanel';
import { getServerLocale } from '@/lib/server-locale';

type Translator = Awaited<ReturnType<typeof getServerLocale>>['t'];

const OAUTH_PLATFORM_NAMES: Record<string, string> = {
  fanvue: 'Fanvue',
  threads: 'Threads',
  patreon: 'Patreon',
  snapchat: 'Snapchat',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  x: 'X',
  youtube: 'YouTube',
  reddit: 'Reddit',
  discord: 'Discord',
};

export const dynamic = 'force-dynamic';

export default async function NetworkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ oauth?: string | string[]; platform?: string | string[] } | undefined> }) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const oauthPlatform = typeof query.platform === 'string' && Object.hasOwn(OAUTH_PLATFORM_NAMES, query.platform)
    ? query.platform
    : '';
  const oauthConnected = query?.oauth === 'connected' && oauthPlatform !== '';
  const session = await getSession();
  const { locale, t } = await getServerLocale();
  const owner = session?.user?.role === 'owner';
  const canManageAccounts = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let network = null;
  let failed = false;
  if (owner) {
    try {
      network = (await api.models.network(id)).data;
    } catch {
      failed = true;
    }
  }
  const accounts = await SocialAccounts({ modelId: id, canManage: canManageAccounts, t });

  return (
    <div className="page-stack">
      {oauthConnected && <p className="notice" role="status">{t('network.oauthSuccess', { platform: OAUTH_PLATFORM_NAMES[oauthPlatform] })}</p>}
      <div className="card">
        <h2>{t('model.networkSecurity')}</h2>
        {!owner && <p>{t('network.ownerOnly')}</p>}
        {failed && <p role="alert">{t('network.configurationLoadFailed')}</p>}
        {network && (
          <div className="stack" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t('network.egressMode')}</span>
              <span className="mono">{network.egressMode ?? t('network.notConfigured')}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t('network.health')}</span>
              {network.healthy ? (
                <span className="badge good">{t('network.healthy')}</span>
              ) : (
                <span className="badge bad">{t('network.degraded')}</span>
              )}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t('network.lastChecked')}</span>
              <span>
                {network.lastCheck && Number.isFinite(Date.parse(network.lastCheck))
                  ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
                      .format(new Date(network.lastCheck))
                  : '—'}
              </span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>{t('network.failureCount')}</span>
              <span>{formatNumber(network.failCount, locale)}</span>
            </div>
            {network.latencyMs != null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{t('network.latency')}</span>
                <span>{formatNumber(network.latencyMs, locale)} ms</span>
              </div>
            )}
            {network.lastEgressIp && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{t('network.lastEgressIp')}</span>
                <span className="mono">{network.lastEgressIp}</span>
              </div>
            )}
            {network.lastError && <div style={{ color: 'var(--bad)' }}>{t('network.lastCheckFailed')}</div>}
          </div>
        )}
        {owner && network && <NetworkForm modelId={id} initial={network} />}
      </div>
      {owner && network?.id && network.egressMode && network.egressMode !== 'direct' && (
        <EgressCredentials
          key={`${network.id}:${network.egressMode}`}
          configId={network.id}
          mode={network.egressMode}
          wgPublicKey={network.wgPublicKey}
          wgEndpoint={network.wgEndpoint}
          wgAllowedIps={network.wgAllowedIps}
          wgPersistentKeepalive={network.wgPersistentKeepalive}
        />
      )}
      {owner && <NetworkHealth modelId={id} />}
      {owner && network?.id && <ActivateNetwork modelId={id} />}
      <div className="card stack">
        <h2>{t('network.socialConnections')}</h2>
        <p className="subtle">{t('network.socialConnectionsDescription')}</p>
        <div className="card stack">
          <h3>{t('network.snapchatTitle')}</h3>
          {canManageAccounts ? <SnapchatConnect modelId={id} /> : <p className="subtle">{t('network.manageAccountsRequired')}</p>}
        </div>
        <div className="card stack">
          <h3>{t('network.telegramTitle')}</h3>
          {canManageAccounts ? <TelegramConnect modelId={id} /> : <p className="subtle">{t('network.manageAccountsRequired')}</p>}
        </div>
        <div className="card stack">
          <h3>{t('network.discordBotTitle')}</h3>
          {canManageAccounts ? <DiscordBotConnect modelId={id} /> : <p className="subtle">{t('network.manageAccountsRequired')}</p>}
        </div>
        {canManageAccounts ? <div className="action-row">
          <a className="btn secondary" href={`/api/v1/connectors/fanvue/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectFanvue')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/threads/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectThreads')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/tiktok/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectTikTok')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/x/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectX')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/youtube/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectYouTube')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/reddit/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectReddit')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/instagram/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectInstagram')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/facebook/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectFacebook')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/discord/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectDiscord')}</a>
          <a className="btn secondary" href={`/api/v1/connectors/patreon/authorize?modelId=${encodeURIComponent(id)}`}>{t('network.connectPatreon')}</a>
          <a className="btn secondary" href={`/models/${encodeURIComponent(id)}/patreon`}>{t('network.patreonCommunity')}</a>
        </div> : <p className="subtle">{t('network.manageAccountsRequired')}</p>}
      </div>
      <div className="card">
        <h2>{t('network.connectedAccounts')}</h2>
        {accounts}
      </div>
    </div>
  );
}

async function SocialAccounts({ modelId, canManage, t }: { modelId: string; canManage: boolean; t: Translator }) {
  let accounts: SocialConnection[] = [];
  try {
    accounts = (await api.social.list(modelId)).data;
  } catch {
    return <p role="alert">{t('network.accountsLoadFailed')}</p>;
  }
  if (accounts.length === 0) {
    return <p style={{ color: 'var(--muted)', margin: 0 }}>{t('network.noAccounts')}</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>{t('network.platform')}</th>
          <th>{t('network.displayName')}</th>
          <th>{t('network.status')}</th>
          <th>{t('network.capabilities')}</th>
          {canManage && <th>{t('network.actions')}</th>}
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => (
          <Fragment key={String(a.id)}>
          <tr>
            <td>{String(a.platform)}</td>
            <td>{String(a.displayName)}</td>
            <td>
              <span className={`badge ${a.status === 'connected' ? 'good' : 'mute'}`}>
                {String(a.status)}
              </span>
              {a.platform === 'snapchat' && a.capabilities.includes('publish.manual_assist') && (
                <span className="badge mute">{t('network.snapchatManualAssist')}</span>
              )}
            </td>
            <td className="mono">{(a.capabilities as string[])?.join(', ') ?? '—'}</td>
            {canManage && <td><div className="action-row">
              {a.status === 'connected' && !a.capabilities.includes('publish.manual_assist') && ['fanvue', 'tiktok', 'x', 'youtube', 'reddit', 'snapchat'].includes(a.platform) && (
                <RefreshSocialAccountButton platform={a.platform as 'fanvue' | 'tiktok' | 'x' | 'youtube' | 'reddit' | 'snapchat'} connectionId={a.id} />
              )}
              <DisconnectSocialAccountButton accountId={a.id} displayName={`${a.platform} (${a.displayName})`} />
            </div></td>}
          </tr>
          {canManage && a.status === 'connected' && (a.capabilities ?? []).some(capability => capability === 'comments.read' || capability.startsWith('messages.') || capability.startsWith('youtube.') || capability.startsWith('vault.')) && <tr>
            <td colSpan={canManage ? 5 : 4}>
              <ProviderOperationsPanel modelId={modelId} connectionId={a.id} capabilities={a.capabilities ?? []} />
            </td>
          </tr>}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
