import { api, getSession } from '@/lib/api';
import FanContactForm from '@/components/FanContactForm';
import CustomRequestForm from '@/components/CustomRequestForm';
import FanInteractionForm from '@/components/FanInteractionForm';
import Link from 'next/link';
import type { FanTimeline } from '@/lib/api';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import FanvueAnalyticsCard from '@/components/FanvueAnalyticsCard';
import FanvueChurnRescuePanel from '@/components/FanvueChurnRescuePanel';
import { getServerLocale } from '@/lib/server-locale';
import type { FanCrmMessageKey } from '@axiom/core';

export const dynamic = 'force-dynamic';

const TIER_BADGE: Record<string, string> = {
  whale: 'good',
  loyal: 'good',
  expired: 'warn',
  new: 'mute',
};
const tierKeys: Record<string, FanCrmMessageKey> = {
  new: 'fans.tierNew',
  loyal: 'fans.tierLoyal',
  whale: 'fans.tierWhale',
  expired: 'fans.tierExpired',
};
const statusKeys: Record<string, FanCrmMessageKey> = {
  pending: 'fans.status.pending',
  filming: 'fans.status.filming',
  editing: 'fans.status.editing',
  delivered: 'fans.status.delivered',
};
const directionKeys: Record<string, FanCrmMessageKey> = {
  inbound: 'fans.fromFan',
  outbound: 'fans.toFan',
};

export default async function FansPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ fan?: string | string[]; cursor?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { locale, t, dateTime } = await getServerLocale();
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  const basePath = `/models/${encodeURIComponent(id)}/fans`;
  const currentList = `${basePath}${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`;
  const session = await getSession();
  if (!talentDestinationAllowed(session?.user?.role, 'fans'))
    return (
      <div className="card stack">
        <h2>{t('fans.accessTitle')}</h2>
        <p>{t('fans.accessDescription')}</p>
        <Link href="/">{t('fans.back')}</Link>
      </div>
    );
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const canSync = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let fans: Awaited<ReturnType<typeof api.models.fans>>['data'] = [];
  let requests: Awaited<ReturnType<typeof api.models.customRequests>>['data'] = [];
  const [contactsResult, requestsResult] = await Promise.allSettled([
    api.models.fans(id, cursor),
    api.models.customRequests(id),
  ]);
  if (contactsResult.status === 'fulfilled') fans = contactsResult.value.data;
  if (requestsResult.status === 'fulfilled') requests = requestsResult.value.data;
  const nextCursor =
    contactsResult.status === 'fulfilled' ? contactsResult.value.meta?.next_cursor : null;
  const selected = query?.fan;
  let timeline: FanTimeline | null = null;
  let timelineError = false;
  if (selected) {
    try {
      if (
        typeof selected !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected)
      )
        throw new Error('Invalid fan');
      const result = (await api.fans.get(selected)).data;
      if (result.fan.modelId !== id) throw new Error('Fan belongs to another talent');
      timeline = result;
    } catch {
      timelineError = true;
    }
  }
  const tierLabel = (tier: string) => (tierKeys[tier] ? t(tierKeys[tier]) : tier);
  const statusLabel = (status: string) => (statusKeys[status] ? t(statusKeys[status]) : status);
  const directionLabel = (direction: string) =>
    directionKeys[direction] ? t(directionKeys[direction]) : direction;

  return (
    <div className="page-stack">
      <div>
        <h2>{t('fans.title')}</h2>
        <p className="subtle">{t('fans.description')}</p>
      </div>
      <FanvueAnalyticsCard modelId={id} canSync={canSync} />
      <FanvueChurnRescuePanel modelId={id} canEdit={canEdit} />
      {canEdit ? (
        <FanContactForm modelId={id} />
      ) : (
        <p className="subtle">{t('fans.accessDescription')}</p>
      )}
      {selected && (
        <section className="card stack" aria-label={t('fans.timeline')}>
          <Link href={currentList}>{t('fans.close')}</Link>
          {timelineError && <p role="alert">{t('fans.timelineError')}</p>}
          {timeline && (
            <>
              <h3>
                {t('fans.activity', { name: timeline.fan.displayName ?? t('fans.fanColumn') })}
              </h3>
              {canEdit && (
                <FanInteractionForm
                  key={timeline.fan.id}
                  fanId={timeline.fan.id}
                  platform={timeline.fan.platform}
                />
              )}
              <p className="subtle">{t('fans.activityDisclaimer')}</p>
              {timeline.touchpoints.length === 0 ? (
                <p>{t('fans.noInteractions')}</p>
              ) : (
                <ol className="stack">
                  {timeline.touchpoints.map((point) => (
                    <li key={point.id}>
                      <strong>
                        {point.platform} · {point.kind} · {directionLabel(point.direction)}
                      </strong>
                      <p>
                        <time dateTime={point.ts}>{dateTime(point.ts)}</time>
                      </p>
                      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {point.content ?? t('fans.noText')}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              <h4>{t('fans.linkedRequests')}</h4>
              {timeline.requests.length === 0 ? (
                <p>{t('fans.noLinkedRequests')}</p>
              ) : (
                timeline.requests.map((request) => (
                  <div className="stack" key={request.id}>
                    <strong>{request.title}</strong>
                    <span>{statusLabel(request.status)}</span>
                    {canEdit && (
                      <CustomRequestForm
                        requestId={request.id}
                        title={request.title}
                        status={request.status}
                      />
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </section>
      )}
      <div className="grid">
        <div className="card">
          <h3>{t('fans.contactsTitle')}</h3>
          {contactsResult.status === 'rejected' ? (
            <p role="alert">{t('fans.contactsLoadFailed')}</p>
          ) : (
            fans.length === 0 && (
              <p style={{ color: 'var(--muted)' }}>
                {cursor ? t('fans.noMoreContacts') : t('fans.noContacts')}
              </p>
            )
          )}
          <table>
            <thead>
              <tr>
                <th>{t('fans.fanColumn')}</th>
                <th>{t('fans.platformColumn')}</th>
                <th>{t('fans.tierColumn')}</th>
                <th>{t('fans.lifetimeColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {fans.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link
                      href={`${basePath}?${new URLSearchParams({ fan: f.id, ...(cursor ? { cursor } : {}) })}`}
                    >
                      {f.displayName ?? f.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{f.platform}</td>
                  <td>
                    <span className={`badge ${TIER_BADGE[f.tier] ?? 'mute'}`}>
                      {tierLabel(f.tier)}
                    </span>
                  </td>
                  <td>{money.format(Number(f.lifetimeValueUsd))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav className="row" aria-label={t('fans.fanColumn')}>
            {cursor && <Link href={basePath}>{t('fans.firstContacts')}</Link>}
            {nextCursor && (
              <Link href={`${basePath}?${new URLSearchParams({ cursor: nextCursor })}`}>
                {t('fans.nextContacts')}
              </Link>
            )}
          </nav>
        </div>
        <div className="card">
          <h3>{t('fans.requestsTitle')}</h3>
          {canEdit && <CustomRequestForm modelId={id} fans={fans} />}
          {requestsResult.status === 'rejected' && (
            <p role="alert">{t('fans.requestsLoadFailed')}</p>
          )}
          {requestsResult.status === 'fulfilled' && requests.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>{t('fans.noRequests')}</p>
          )}
          <table>
            <thead>
              <tr>
                <th>{t('fans.requestTitleColumn')}</th>
                <th>{t('fans.statusColumn')}</th>
                <th>{t('fans.priceColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    <span className={`badge ${r.status === 'delivered' ? 'good' : 'warn'}`}>
                      {statusLabel(r.status)}
                    </span>
                    {canEdit && (
                      <CustomRequestForm requestId={r.id} status={r.status} title={r.title} />
                    )}
                  </td>
                  <td>
                    {r.priceUsd === null ? t('fans.noPrice') : money.format(Number(r.priceUsd))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
