import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import type { InboxObservation } from '@/lib/inbox-types';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import InboxReplies from '@/components/InboxReplies';
import InboxAttachments from '@/components/InboxAttachments';

export const dynamic = 'force-dynamic';
type Query = { connectionId?: string | string[]; userUuid?: string | string[]; page?: string | string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'inbox')) return <div className="card stack"><h2>Inbox access unavailable</h2><p>Your role does not include messages.</p><Link href="/">Back to workspace</Link></div>;
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
  let error = valid ? null : 'Invalid inbox selection. Choose an account and conversation again.';
  try { accounts = (await api.models.inboxAccounts(id)).data.accounts; }
  catch { error = 'Inbox access could not be loaded. Your assignment or shift may have ended. Refresh or contact your workspace owner.'; }
  if (valid && accounts && connectionId) {
    if (!accounts.some(a => a.id === connectionId)) error = 'The selected account is unavailable. Choose a connected account.';
    else try { observation = (await api.models.inbox(id, connectionId, page, userUuid)).data; }
    catch { error = 'Messages could not be loaded. Check account access, chat permission and model network. This does not mean the inbox is empty.'; }
  }
  const inbox = observation?.inbox;
  return <div className="page-stack">
    <div><h2>Inbox</h2><p>Read Fanvue conversations for this talent. Opening a conversation does not mark it read. Review and explicitly send your prepared replies below a conversation. Load attachment details to choose an available preview; this never purchases media.</p></div>
    {error && <div className="card stack" role="alert"><p>{error}</p><Link className="btn secondary" href={path} prefetch={false}>Reload account choices</Link></div>}
    {accounts?.length === 0 && <div className="card stack"><h3>No connected Fanvue account</h3><p>Ask your workspace owner to connect an account for this talent.</p></div>}
    {accounts && accounts.length > 0 && <form action={path} method="get" className="card stack">
      <label htmlFor="inbox-account">Fanvue account</label><select name="connectionId" id="inbox-account" required defaultValue={accounts.some(a => a.id === connectionId) ? connectionId : ''}>
        <option value="" disabled>Select an account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select><div className="action-row"><button className="btn" type="submit">Load conversations</button></div>
    </form>}
    {inbox && observation && <>
      <div className="card stack"><p>Last retrieved: {observation.observedAt}. This is a snapshot; it does not update automatically.</p>
        <form action={path} method="get"><input type="hidden" name="connectionId" value={connectionId} /><input type="hidden" name="page" value={page} />{userUuid && <input type="hidden" name="userUuid" value={userUuid} />}<button className="btn secondary" type="submit">Refresh this page</button></form>
        {userUuid && <Link href={href(1)} prefetch={false}>Back to conversations</Link>}
      </div>
      {inbox.data.length === 0 && <p>No {inbox.kind === 'chats' ? 'conversations' : 'messages'} returned on this page.</p>}
      {inbox.kind === 'chats' ? inbox.data.map(chat => <article className="card stack" key={chat.user.uuid}>
        <h3>{chat.user.nickname || chat.user.displayName || chat.user.handle}</h3><p>@{chat.user.handle}</p>
        <p>{chat.isRead ? 'Read' : 'Unread'} · {chat.unreadMessagesCount} unread messages{chat.isMuted ? ' · Muted' : ''}</p>
        {chat.lastMessage ? <><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{chat.lastMessage.text ?? (chat.lastMessage.hasGif ? 'GIF attachment' : chat.lastMessage.hasMedia ? 'Media attachment' : 'No text')}</p><p>{chat.lastMessage.senderRole} · {chat.lastMessage.type} · {chat.lastMessage.sentAt ?? 'Time unavailable'}</p></> : <p>No last-message preview.</p>}
        <Link href={href(1, chat.user.uuid)} prefetch={false} className="btn secondary">Open conversation</Link>
      </article>) : inbox.data.map(message => <article className="card stack" key={message.uuid}>
        <h3>@{message.sender.handle}</h3><p>{message.sentAt ?? 'Time unavailable'} · {message.type} · {message.isRead ? 'Read by recipient' : 'Not read by recipient'}</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text ?? 'No text in this message.'}</p>
        {message.hasMedia && <p>{message.mediaType ?? 'Media'} attachment · {message.mediaUuids.length} item(s).</p>}
        {message.hasMedia && userUuid && <InboxAttachments key={`${id}:${connectionId}:${userUuid}:${message.uuid}`}
          modelId={id} connectionId={connectionId} userUuid={userUuid} messageUuid={message.uuid} mediaUuids={message.mediaUuids} />}
        {message.gif && <p>GIF: {message.gif.title ?? message.gif.id}. Preview unavailable.</p>}
        {message.pricing && <p>Pay-to-view price: {(message.pricing.USD.price / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · {message.purchasedAt ? `Purchased ${message.purchasedAt}` : 'No purchase recorded'}</p>}
        {message.tipSource && <p>Tip source: {message.tipSource}</p>}
        {message.sentByUserId && <p>Sent by team member: {message.sentByUserId}</p>}
        {message.appUuid && <p>Sent through app: {message.appUuid}</p>}
      </article>)}
      <nav className="action-row" aria-label="Inbox pages">
        {page > 1 && <Link href={href(page - 1, userUuid)} prefetch={false} className="btn secondary">Previous page</Link>}
        <span>Page {inbox.pagination.page}</span>
        {inbox.pagination.hasMore && page < 999999 && <Link href={href(page + 1, userUuid)} prefetch={false} className="btn secondary">Next page</Link>}
      </nav>
      {inbox.kind === 'messages' && userUuid && <InboxReplies key={`${id}:${connectionId}:${userUuid}`} modelId={id} connectionId={connectionId} counterpartUuid={userUuid} actorUserId={session?.user?.id} canPrepare={['owner', 'manager', 'operator', 'chatter'].includes(role ?? '')} />}
    </>}
  </div>;
}
