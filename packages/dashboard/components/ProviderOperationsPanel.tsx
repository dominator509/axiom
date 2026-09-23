'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { clientApi as api } from '@/lib/client-api';
import { useLocale } from './LocaleProvider';
import FanvueVaultPanel from './FanvueVaultPanel';

type Comment = { id: string; text: string; authorName?: string; permalink?: string; createdAt?: string };
type ProviderMessage = { id: string; conversationId: string; senderId: string; text: string; createdAt?: string };
type YouTubePlaylist = { id: string; title: string; description?: string; privacyStatus?: string };
type YouTubeCaption = { id: string; language: string; name?: string; status?: string; isDraft?: boolean };
type ModelMedia = { id: string; kind: string; mimeType: string; fileSize: number; createdAt: string };
type QueuedPublicSfwReply = { jobId: string; status: 'queued'; scheduledFor: string; text: string };
const moderationOptions = [
  { action: 'hide', key: 'network.hideComment' },
  { action: 'delete', key: 'network.deleteComment' },
  { action: 'approve', key: 'network.approveComment' },
  { action: 'reject', key: 'network.rejectComment' },
  { action: 'block', key: 'network.blockCommentAuthor' },
] as const;

export function moderationOptionsForCapabilities(capabilities: readonly string[]) {
  return moderationOptions.filter(({ action }) => capabilities.includes(`comments.moderate.${action}`));
}

export default function ProviderOperationsPanel({
  modelId,
  connectionId,
  platform,
  canConfigurePublicInvite = false,
  capabilities,
}: {
  modelId: string;
  connectionId: string;
  platform?: string;
  canConfigurePublicInvite?: boolean;
  capabilities: string[];
}) {
  const { t } = useLocale();
  const [postId, setPostId] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [privateInviteUrl, setPrivateInviteUrl] = useState('');
  const [savedInviteUrl, setSavedInviteUrl] = useState('');
  const [inviteSettingsLoaded, setInviteSettingsLoaded] = useState(false);
  const [inviteSettingsBusy, setInviteSettingsBusy] = useState(false);
  const [publicSfwReplies, setPublicSfwReplies] = useState<Record<string, QueuedPublicSfwReply>>({});
  const [recipientId, setRecipientId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [providerMessages, setProviderMessages] = useState<ProviderMessage[]>([]);
  const [youtubeVideoId, setYoutubeVideoId] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [playlistItemId, setPlaylistItemId] = useState('');
  const [captionId, setCaptionId] = useState('');
  const [captionLanguage, setCaptionLanguage] = useState('en');
  const [captionName, setCaptionName] = useState('');
  const [thumbnailAssetId, setThumbnailAssetId] = useState('');
  const [captionAssetId, setCaptionAssetId] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'unlisted' | 'public'>('private');
  const [captionIsDraft, setCaptionIsDraft] = useState(false);
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([]);
  const [captions, setCaptions] = useState<YouTubeCaption[]>([]);
  const [modelMedia, setModelMedia] = useState<ModelMedia[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const hasComments = capabilities.includes('comments.read');
  const hasPublicSfwFunnel = hasComments && capabilities.includes('comments.reply')
    && ['x', 'instagram', 'reddit'].includes(platform ?? '');
  const hasMessagesRead = capabilities.includes('messages.read');
  const hasMessagesSend = capabilities.includes('messages.send');
  const hasMessages = hasMessagesRead || hasMessagesSend;
  const hasVault = capabilities.some(capability => capability.startsWith('vault.'));
  const youtubeOperations = capabilities.filter(capability => capability.startsWith('youtube.'));
  const hasYoutube = youtubeOperations.length > 0;
  const needsYoutubeAsset = youtubeOperations.includes('youtube.thumbnail.set') || youtubeOperations.includes('youtube.captions.upload');

  useEffect(() => {
    if (!hasYoutube || !needsYoutubeAsset) return;
    let cancelled = false;
    setLoadingAssets(true);
    void (async () => {
      const media: ModelMedia[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await api.models.media(modelId, cursor);
        media.push(...result.data);
        cursor = result.meta?.next_cursor ?? undefined;
        if (!cursor) break;
      }
      if (!cancelled) setModelMedia(media);
    })().catch(() => {
      if (!cancelled) setMessage(t('network.operationFailed'));
    }).finally(() => {
      if (!cancelled) setLoadingAssets(false);
    });
    return () => { cancelled = true; };
  }, [hasYoutube, modelId, needsYoutubeAsset, t]);

  useEffect(() => {
    if (!hasPublicSfwFunnel) return;
    let cancelled = false;
    void api.social.publicSfwSettings(modelId).then(result => {
      if (cancelled) return;
      const configured = result.data.privateInviteUrl ?? '';
      setPrivateInviteUrl(configured);
      setSavedInviteUrl(configured);
      setInviteSettingsLoaded(true);
    }).catch(() => {
      if (!cancelled) setMessage(t('network.operationFailed'));
    });
    return () => { cancelled = true; };
  }, [hasPublicSfwFunnel, modelId, t]);

  if (!hasComments && !hasMessages && !hasVault && !hasYoutube) return null;

  async function loadComments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!postId.trim() || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.social.operate(modelId, connectionId, { type: 'comments.read', postId: postId.trim(), limit: 50 });
      const data = result.data as { items?: Comment[]; type?: string };
      if (data.type !== 'comments' || !Array.isArray(data.items)) throw new Error('Invalid provider response');
      setComments(data.items);
      setMessage(data.items.length === 0 ? t('network.noComments') : t('network.operationSucceeded'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function runCommentAction(operation: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.social.operate(modelId, connectionId, operation);
      setMessage(t('network.operationSucceeded'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function queuePublicSfwReply(comment: Comment) {
    if (busy || !savedInviteUrl || privateInviteUrl.trim() !== savedInviteUrl) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.social.publicSfwReply(modelId, connectionId, {
        postId: postId.trim(), commentId: comment.id,
      });
      setPublicSfwReplies(current => ({ ...current, [comment.id]: result.data }));
      setMessage(t('network.publicSfwQueued'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function savePublicSfwSettings() {
    if (inviteSettingsBusy || !inviteSettingsLoaded) return;
    setInviteSettingsBusy(true);
    setMessage('');
    try {
      const result = await api.social.savePublicSfwSettings(modelId, privateInviteUrl.trim() || null);
      const configured = result.data.privateInviteUrl ?? '';
      setPrivateInviteUrl(configured);
      setSavedInviteUrl(configured);
      setMessage(t('network.publicSfwSettingsSaved'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setInviteSettingsBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !recipientId.trim() || !messageText.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await api.social.operate(modelId, connectionId, {
        type: 'messages.send',
        recipientId: recipientId.trim(),
        text: messageText.trim(),
      });
      setMessageText('');
      setMessage(t('network.operationSucceeded'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function loadMessages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.social.operate(modelId, connectionId, {
        type: 'messages.read',
        ...(conversationId.trim() ? { conversationId: conversationId.trim() } : {}),
        limit: 50,
      });
      const data = result.data as { type?: string; items?: ProviderMessage[] };
      if (data.type !== 'messages' || !Array.isArray(data.items)) throw new Error('Invalid provider response');
      setProviderMessages(data.items);
      setMessage(data.items.length === 0 ? t('network.noMessages') : t('network.operationSucceeded'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function runYouTubeOperation(operation: Record<string, unknown>) {
    if (busy) return undefined;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.social.operate(modelId, connectionId, operation);
      const data = result.data as { type?: string; items?: unknown[]; nextCursor?: string };
      if (data.type === 'youtube.playlists' && Array.isArray(data.items)) setPlaylists(data.items as YouTubePlaylist[]);
      if (data.type === 'youtube.captions' && Array.isArray(data.items)) setCaptions(data.items as YouTubeCaption[]);
      setMessage(t('network.operationSucceeded'));
      return data;
    } catch {
      setMessage(t('network.operationFailed'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const imageAssets = modelMedia.filter(asset => asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/png');
  const captionAssets = modelMedia.filter(asset => /^(text\/(plain|vtt|xml)|application\/(x-subrip|octet-stream))$/i.test(asset.mimeType));

  return <>
    {(hasComments || hasMessages || hasYoutube) && <section className="stack" aria-label={t('network.providerOperations')}>
      <h3>{t('network.providerOperations')}</h3>
      {hasComments && <>
      {hasPublicSfwFunnel && <div className="stack" aria-label={t('network.publicSfwReply')}>
        <p className="subtle">{t('network.publicSfwDescription')}</p>
        <label>{t('network.privateInviteUrl')}
          <input type="url" value={privateInviteUrl} maxLength={512} disabled={!inviteSettingsLoaded || !canConfigurePublicInvite} onChange={event => setPrivateInviteUrl(event.target.value)} />
        </label>
        {canConfigurePublicInvite && <button type="button" disabled={!inviteSettingsLoaded || inviteSettingsBusy || privateInviteUrl.trim() === savedInviteUrl} onClick={() => void savePublicSfwSettings()}>
          {t('network.savePublicSfwSettings')}
        </button>}
      </div>}
      <form className="action-row" onSubmit={(event) => void loadComments(event)}>
        <label>
          {t('network.commentPostId')}
          <input value={postId} maxLength={256} required onChange={(event) => setPostId(event.target.value)} />
        </label>
        <button type="submit" disabled={busy}>{busy ? t('network.loadingComments') : t('network.loadComments')}</button>
      </form>
      {comments.map((comment) => (
        <article className="card" key={comment.id}>
          <p>{comment.authorName ? `${comment.authorName}: ` : ''}{comment.text}</p>
          {comment.permalink && <a href={comment.permalink} target="_blank" rel="noreferrer">{comment.permalink}</a>}
          {capabilities.includes('comments.reply') && (
            <form className="action-row" onSubmit={(event) => {
              event.preventDefault();
              const text = reply[comment.id]?.trim();
              if (text) void runCommentAction({ type: 'comments.reply', commentId: comment.id, text });
            }}>
              <label>
                {t('network.replyToComment')}
                <input value={reply[comment.id] ?? ''} maxLength={10_000} required onChange={(event) => setReply((current) => ({ ...current, [comment.id]: event.target.value }))} />
              </label>
              <button type="submit" disabled={busy}>{t('network.sendReply')}</button>
            </form>
          )}
          {hasPublicSfwFunnel && <>
            <button type="button" disabled={busy || !savedInviteUrl || privateInviteUrl.trim() !== savedInviteUrl} onClick={() => void queuePublicSfwReply(comment)}>
              {t('network.publicSfwReply')}
            </button>
            {publicSfwReplies[comment.id] && <p role="status">
              {t('network.publicSfwQueued')}<br />
              <time dateTime={publicSfwReplies[comment.id]!.scheduledFor}>{publicSfwReplies[comment.id]!.scheduledFor}</time><br />
              {publicSfwReplies[comment.id]!.text}
            </p>}
          </>}
          {moderationOptionsForCapabilities(capabilities).map(({ action, key }) => (
            <button key={action} type="button" disabled={busy} onClick={() => {
              if (window.confirm(t('network.confirmModerationAction'))) void runCommentAction({ type: 'comments.moderate', commentId: comment.id, action });
            }}>{t(key)}</button>
          ))}
        </article>
      ))}
      </>}
      {hasMessagesRead && <>
        <form className="action-row" onSubmit={(event) => void loadMessages(event)}>
          <label>
            {t('network.recipientId')}
            <input value={conversationId} maxLength={256} onChange={(event) => setConversationId(event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? t('network.loadingMessages') : t('network.loadMessages')}</button>
        </form>
        {providerMessages.map((item) => <article className="card" key={item.id}>
          <p>{item.senderId}: {item.text}</p>
          {item.createdAt && <time dateTime={item.createdAt}>{item.createdAt}</time>}
        </article>)}
      </>}
      {hasMessagesSend && (
        <form className="action-row" onSubmit={(event) => void sendMessage(event)}>
          <label>
            {t('network.recipientId')}
            <input value={recipientId} maxLength={256} required onChange={(event) => setRecipientId(event.target.value)} />
          </label>
          <label>
            {t('network.sendMessage')}
            <textarea value={messageText} maxLength={10_000} required onChange={(event) => setMessageText(event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{t('network.sendMessage')}</button>
        </form>
      )}
      {hasYoutube && <div className="stack" aria-label="YouTube operations">
        {youtubeOperations.includes('youtube.playlists.read') && <button type="button" disabled={busy} onClick={() => void runYouTubeOperation({ type: 'youtube.playlists.read', limit: 50 })}>
          {t('network.youtubeLoadPlaylists')}
        </button>}
        {playlists.map(item => <article className="card" key={item.id}>
          <p>{item.title} · {item.privacyStatus ?? ''}</p><code>{item.id}</code>
        </article>)}
        {youtubeOperations.includes('youtube.playlist.create') && <form className="action-row" onSubmit={(event) => {
          event.preventDefault();
          void runYouTubeOperation({ type: 'youtube.playlist.create', title: playlistTitle.trim(), privacyStatus });
        }}>
          <label>{t('network.youtubePlaylistTitle')}<input required maxLength={150} value={playlistTitle} onChange={(event) => setPlaylistTitle(event.target.value)} /></label>
          <label>{t('network.youtubePrivacy')}<select value={privacyStatus} onChange={(event) => setPrivacyStatus(event.target.value as 'private' | 'unlisted' | 'public')}>
            <option value="private">{t('network.youtubePrivate')}</option><option value="unlisted">{t('network.youtubeUnlisted')}</option><option value="public">{t('network.youtubePublic')}</option>
          </select></label>
          <button type="submit" disabled={busy}>{t('network.youtubeCreatePlaylist')}</button>
        </form>}
        {youtubeOperations.includes('youtube.playlist.add-video') && <form className="action-row" onSubmit={(event) => {
          event.preventDefault();
          void runYouTubeOperation({ type: 'youtube.playlist.add-video', playlistId: playlistId.trim(), videoId: youtubeVideoId.trim() });
        }}>
          <label>{t('network.youtubePlaylistId')}<input required maxLength={256} value={playlistId} onChange={(event) => setPlaylistId(event.target.value)} /></label>
          <label>{t('network.youtubeVideoId')}<input required maxLength={256} value={youtubeVideoId} onChange={(event) => setYoutubeVideoId(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{t('network.youtubeAddVideo')}</button>
        </form>}
        {youtubeOperations.includes('youtube.playlist.remove-video') && <form className="action-row" onSubmit={(event) => {
          event.preventDefault();
          void runYouTubeOperation({ type: 'youtube.playlist.remove-video', playlistItemId: playlistItemId.trim() });
        }}>
          <label>{t('network.youtubePlaylistItemId')}<input required maxLength={256} value={playlistItemId} onChange={(event) => setPlaylistItemId(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{t('network.youtubeRemoveVideo')}</button>
        </form>}
        {youtubeOperations.includes('youtube.thumbnail.set') && <form className="action-row" onSubmit={(event) => {
          event.preventDefault();
          void runYouTubeOperation({ type: 'youtube.thumbnail.set', videoId: youtubeVideoId.trim(), assetId: thumbnailAssetId });
        }}>
          <label>{t('network.youtubeVideoId')}<input required maxLength={256} value={youtubeVideoId} onChange={(event) => setYoutubeVideoId(event.target.value)} /></label>
          <label>{t('network.youtubeAsset')}<select required value={thumbnailAssetId} onChange={(event) => setThumbnailAssetId(event.target.value)} disabled={loadingAssets || imageAssets.length === 0}>
            <option value="">{loadingAssets ? t('network.youtubeLoadingAssets') : imageAssets.length === 0 ? t('network.youtubeNoAssets') : ''}</option>
            {imageAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.mimeType} · {asset.fileSize} B · {asset.id}</option>)}
          </select></label>
          <button type="submit" disabled={busy || loadingAssets || !thumbnailAssetId}>{t('network.youtubeSetThumbnail')}</button>
        </form>}
        {youtubeOperations.includes('youtube.captions.list') && <button type="button" disabled={busy || !youtubeVideoId.trim()} onClick={() => void runYouTubeOperation({ type: 'youtube.captions.list', videoId: youtubeVideoId.trim() })}>
          {t('network.youtubeLoadCaptions')}
        </button>}
        {captions.map(item => <article className="card" key={item.id}>
          <p>{item.language}{item.name ? ` · ${item.name}` : ''}{item.isDraft ? ' · draft' : ''}</p><code>{item.id}</code>
        </article>)}
        {youtubeOperations.includes('youtube.captions.upload') && <form className="action-row" onSubmit={(event) => {
          event.preventDefault();
          void runYouTubeOperation({ type: 'youtube.captions.upload', videoId: youtubeVideoId.trim(), language: captionLanguage.trim(), name: captionName.trim(), assetId: captionAssetId, isDraft: captionIsDraft });
        }}>
          <label>{t('network.youtubeVideoId')}<input required maxLength={256} value={youtubeVideoId} onChange={(event) => setYoutubeVideoId(event.target.value)} /></label>
          <label>{t('network.youtubeCaptionLanguage')}<input required maxLength={64} value={captionLanguage} onChange={(event) => setCaptionLanguage(event.target.value)} /></label>
          <label>{t('network.youtubeCaptionName')}<input required maxLength={150} value={captionName} onChange={(event) => setCaptionName(event.target.value)} /></label>
          <label>{t('network.youtubeAsset')}<select required value={captionAssetId} onChange={(event) => setCaptionAssetId(event.target.value)} disabled={loadingAssets || captionAssets.length === 0}>
            <option value="">{loadingAssets ? t('network.youtubeLoadingAssets') : captionAssets.length === 0 ? t('network.youtubeNoAssets') : ''}</option>
            {captionAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.mimeType} · {asset.fileSize} B · {asset.id}</option>)}
          </select></label>
          <label><input type="checkbox" checked={captionIsDraft} onChange={(event) => setCaptionIsDraft(event.target.checked)} />{t('network.youtubeDraftCaption')}</label>
          <button type="submit" disabled={busy || loadingAssets || !captionAssetId}>{t('network.youtubeUploadCaption')}</button>
        </form>}
        {youtubeOperations.includes('youtube.captions.delete') && <form className="action-row" onSubmit={(event) => {
          event.preventDefault();
          void runYouTubeOperation({ type: 'youtube.captions.delete', captionId: captionId.trim() });
        }}>
          <label>{t('network.youtubeCaptionId')}<input required maxLength={256} value={captionId} onChange={(event) => setCaptionId(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{t('network.youtubeDeleteCaption')}</button>
        </form>}
      </div>}
      {message && <p role="status">{message}</p>}
    </section>}
    {hasVault && <FanvueVaultPanel modelId={modelId} connectionId={connectionId} capabilities={capabilities} />}
  </>;
}
