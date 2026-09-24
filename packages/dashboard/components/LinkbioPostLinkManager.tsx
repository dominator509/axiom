'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export interface LinkbioPublishedPost {
  id: string;
  platform: string;
  publishedAt: string | null;
  caption: string;
}

export interface LinkbioPostAttributionLink {
  id: string;
  slug: string;
  targetUrl: string;
  postTargetId: string;
  clicks: number;
  createdAt: string;
  path: string;
}

export default function LinkbioPostLinkManager({ modelId, posts, links, canEdit }: {
  modelId: string;
  posts: LinkbioPublishedPost[];
  links: LinkbioPostAttributionLink[];
  canEdit: boolean;
}) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [postTargetId, setPostTargetId] = useState(posts[0]?.id ?? '');
  const [targetUrl, setTargetUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const intent = useRef<{ key: string; body: string } | null>(null);
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  async function createLink() {
    if (busy || !canEdit || !postTargetId) return;
    intent.current ??= {
      key: createIdempotencyKey(),
      body: JSON.stringify({ postTargetId, targetUrl: targetUrl.trim() }),
    };
    setBusy(true);
    setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/linkbio/post-links`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setMessage(t('linkbio.postLinks.failed'));
        return;
      }
      const result = await readDashboardJson<{ data?: { path?: string } }>(response);
      if (!result.data?.path) throw new Error('link response was not confirmed');
      intent.current = null;
      setTargetUrl('');
      setMessage(t('linkbio.postLinks.created'));
      router.refresh();
    } catch {
      setMessage(t('linkbio.postLinks.failed'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createLink();
  }

  async function copyLink(link: LinkbioPostAttributionLink) {
    try {
      await navigator.clipboard.writeText(new URL(link.path, window.location.origin).toString());
      setCopiedId(link.id);
      setMessage(t('linkbio.postLinks.copied'));
    } catch {
      setMessage(t('linkbio.postLinks.failed'));
    }
  }

  return <section className="card stack" aria-label={t('linkbio.postLinks.title')}>
    <h3>{t('linkbio.postLinks.title')}</h3>
    <p className="subtle">{t('linkbio.postLinks.description')}</p>
    {posts.length === 0 ? <p className="subtle">{t('linkbio.postLinks.noPosts')}</p> : canEdit ? <form className="row" onSubmit={submit}>
      <label>{t('linkbio.postLinks.choosePost')}
        <select value={postTargetId} onChange={event => setPostTargetId(event.target.value)} disabled={busy || intent.current !== null} required>
          {posts.map(post => <option key={post.id} value={post.id}>
            {[post.platform, post.publishedAt ? date.format(new Date(post.publishedAt)) : '', post.caption].filter(Boolean).join(' · ')}
          </option>)}
        </select>
      </label>
      <label style={{ flex: 1 }}>{t('linkbio.postLinks.destination')}
        <input type="url" value={targetUrl} onChange={event => setTargetUrl(event.target.value)} disabled={busy || intent.current !== null} required />
      </label>
      <button className="btn" type="submit" disabled={busy || !targetUrl.trim()}>{t('linkbio.postLinks.create')}</button>
      {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void createLink()}>{t('linkbio.retry')}</button>}
    </form> : <p className="subtle">{t('linkbio.roleRequiredEdit')}</p>}
    {links.length === 0 ? <p className="subtle">{t('linkbio.postLinks.empty')}</p> : <div style={{ overflowX: 'auto' }}><table>
      <thead><tr><th scope="col">{t('linkbio.postLinks.choosePost')}</th><th scope="col">{t('modelSurface.shortLink')}</th><th scope="col">{t('modelSurface.clicks')}</th><th scope="col" /></tr></thead>
      <tbody>{links.map(link => {
        const post = posts.find(item => item.id === link.postTargetId);
        return <tr key={link.id}>
          <td>{post ? [post.platform, post.caption].filter(Boolean).join(' · ') : link.postTargetId}</td>
          <td><a href={link.path}>{link.path}</a></td>
          <td>{t('linkbio.postLinks.clicks', { count: number.format(link.clicks) })}</td>
          <td><button className="btn secondary" type="button" onClick={() => void copyLink(link)}>
            {copiedId === link.id ? t('linkbio.postLinks.copied') : t('linkbio.postLinks.copy')}
          </button></td>
        </tr>;
      })}</tbody>
    </table></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
