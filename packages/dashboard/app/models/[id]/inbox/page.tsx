import Link from 'next/link';
import { formatCurrency } from '@axiom/core';
import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';
import type { InboxObservation } from '@/lib/inbox-types';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import InboxReplies from '@/components/InboxReplies';
import InboxAttachments from '@/components/InboxAttachments';

export const dynamic = 'force-dynamic';
type Query = { connectionId?: string | string[]; userUuid?: string | string[]; page?: string | string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const { locale, t, dateTime } = await getServerLocale();
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'inbox')) return <div className="card stack"><h2>{t('inbox.accessUnavailable')}</h2><p>{t('inbox.accessUnavailableDescription')}</p><Link href="/">{t('inbox.back')}</Link></div>;
  const query = await searchParams;
  const connectionId = typeof query.connectionId === 'string' ? query.connectionId : '';
  const userUuid = typeof query.userUuid === 'string' ? query.userUuid : undefined;
  const pageText = query.page ?? '1';
  const valid = !Array.isArray(query.connectionId) && !Array.isArray(query.userUuid)
    && typeof pageText === 'string' && /^[1-9][0-9]{0,5}$/.test(pageText)
    && (!userUuid || (uuid.test(userUuid) && Boolean(connectionId)));
  const page = valid ? Number(pageText) : 1;
  const path = `/models/${encodeURIComponent(id)}/inbox`;
  const href = (nextPage: number, counterpart?: string) => `${path}?${new URLSearchParams({ connectionId, page: String(nextPage), ...(counterpart ? { userUuid: counterpart } : {}) })}`;
  let accounts: Array<{ id: string; displayName: string }> | null = null;
  let observation: InboxObservation | null = null;
  let error = valid ? null : t('inbox.invalidSelection');
  try { accounts = (await api.models.inboxAccounts(id)).data.accounts; }
  catch { error = t('inbox.loadFailed'); }
  if (valid && accounts && connectionId) {
    if (!accounts.some(a => a.id === connectionId)) error = t('inbox.accountUnavailable');
    else try { observation = (await api.models.inbox(id, connectionId, page, userUuid)).data; }
    catch { error = t('inbox.messagesLoadFailed'); }
  }
  const inbox = observation?.inbox;
  // Explicit unavailable state for a malformed or absent observation timestamp.
  const observedOk = Boolean(observation?.observedAt) && Number.isFinite(Date.parse(String(observation?.observedAt)));
  const observedText = observation && observedOk ? dateTime(String(observation.observedAt)) : t('inbox.timeUnavailable');
  return <div className="page-stack">
    <div><h2>{t('inbox.title')}</h2><p>{t('inbox.description')}</p></div>
    {error && <div className="card stack" role="alert"><p>{error}</p><Link className="btn secondary" href={path} prefetch={false}>{t('inbox.reloadChoices')}</Link></div>}
    {accounts?.length === 0 && <div className="card stack"><h3>{t('inbox.noAccount')}</h3><p>{t('inbox.noAccountContact')}</p></div>}
    {accounts && accounts.length > 0 && <form action={path} method="get" className="card stack">
      <label htmlFor="inbox-account">{t('inbox.accountLabel')}</label><select name="connectionId" id="inbox-account" required defaultValue={accounts.some(a => a.id === connectionId) ? connectionId : ''}>
        <option value="" disabled>{t('inbox.selectAccount')}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select><div className="action-row"><button className="btn" type="submit">{t('inbox.loadConversations')}</button></div>
    </form>}
    {inbox && observation && <>
      <div className="card stack"><p>{t('inbox.lastRetrieved', { time: observedText })} {t('inbox.snapshotNote')}</p>
        <form action={path} method="get"><input type="hidden" name="connectionId" value={connectionId} /><input type="hidden" name="page" value={page} />{userUuid && <input type="hidden" name="userUuid" value={userUuid} />}<button className="btn secondary" type="submit">{t('inbox.refreshPage')}</button></form>
        {userUuid && <Link href={href(1)} prefetch={false}>{t('inbox.backToConversations')}</Link>}
      </div>
      {inbox.data.length === 0 && <p>{t('inbox.emptyKindPage', { kind: inbox.kind === 'chats' ? t('inbox.conversations') : t('inbox.messages') })}</p>}
      {inbox.kind === 'chats' ? inbox.data.map(chat => <article className="card stack" key={chat.user.uuid}>
        <h3>{chat.user.nickname || chat.user.displayName || chat.user.handle}</h3><p>@{chat.user.handle}</p>
        <p>{chat.isRead ? t('inbox.read') : t('inbox.unread')} · {t('inbox.unreadMessages', { count: chat.unreadMessagesCount })}{chat.isMuted ? ` · ${t('inbox.muted')}` : ''}</p>
        {chat.lastMessage ? <><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{chat.lastMessage.text ?? (chat.lastMessage.hasGif ? t('inbox.gifAttachment') : chat.lastMessage.hasMedia ? t('inbox.mediaAttachment') : t('inbox.noText'))}</p><p>{chat.lastMessage.senderRole} · {chat.lastMessage.type} · {chat.lastMessage.sentAt && Number.isFinite(Date.parse(chat.lastMessage.sentAt)) ? dateTime(chat.lastMessage.sentAt) : t('inbox.timeUnavailable')}</p></> : <p>{t('inbox.noLastMessage')}</p>}
        <Link href={href(1, chat.user.uuid)} prefetch={false} className="btn secondary">{t('inbox.openConversation')}</Link>
      </article>) : inbox.data.map(message => <article className="card stack" key={message.uuid}>
        <h3>@{message.sender.handle}</h3><p>{message.sentAt && Number.isFinite(Date.parse(message.sentAt)) ? dateTime(message.sentAt) : t('inbox.timeUnavailable')} · {message.type} · {message.isRead ? t('inbox.readByRecipient') : t('inbox.notReadByRecipient')}</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text ?? t('inbox.noTextInMessage')}</p>
        {message.hasMedia && <p>{t('inbox.mediaItems', { type: message.mediaType ?? t('inbox.mediaAttachment'), count: message.mediaUuids.length })}</p>}
        {message.hasMedia && userUuid && <InboxAttachments key={`${id}:${connectionId}:${userUuid}:${message.uuid}`}
          modelId={id} connectionId={connectionId} userUuid={userUuid} messageUuid={message.uuid} mediaUuids={message.mediaUuids} />}
        {message.gif && <p>{t('inbox.gifPreviewUnavailable', { title: message.gif.title ?? message.gif.id })}</p>}
        {message.pricing && <p>{t('inbox.payToViewPrice', { price: formatCurrency(message.pricing.USD.price / 100, locale, 'USD') })} · {message.purchasedAt && Number.isFinite(Date.parse(message.purchasedAt)) ? t('inbox.purchased', { time: dateTime(message.purchasedAt) }) : t('inbox.noPurchase')}</p>}
        {message.tipSource && <p>{t('inbox.tipSource', { value: message.tipSource })}</p>}
        {message.sentByUserId && <p>{t('inbox.sentByTeamMember', { value: message.sentByUserId })}</p>}
        {message.appUuid && <p>{t('inbox.sentThroughApp', { value: message.appUuid })}</p>}
      </article>)}
      <nav className="action-row" aria-label={t('inbox.pagesAria')}>
        {page > 1 && <Link href={href(page - 1, userUuid)} prefetch={false} className="btn secondary">{t('inbox.previousPage')}</Link>}
        <span>{t('inbox.page', { page: inbox.pagination.page })}</span>
        {inbox.pagination.hasMore && page < 999999 && <Link href={href(page + 1, userUuid)} prefetch={false} className="btn secondary">{t('inbox.nextPage')}</Link>}
      </nav>
      {inbox.kind === 'messages' && userUuid && <InboxReplies key={`${id}:${connectionId}:${userUuid}`} modelId={id} connectionId={connectionId} counterpartUuid={userUuid} actorUserId={session?.user?.id} canPrepare={['owner', 'manager', 'operator', 'chatter'].includes(role ?? '')} />}
    </>}
  </div>;
}
