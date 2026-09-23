'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

interface ModerationRule {
  id: string;
  name: string;
  platform: string;
  keywords: string[];
  action: 'hide' | 'hide_and_block';
  enabled: boolean;
}

interface ModerationHistory {
  id: string;
  ruleId: string;
  postId: string;
  status: 'pending' | 'applied' | 'partial' | 'unknown' | 'unsupported';
  matchedKeywordCount: number;
  createdAt: string;
}

interface Connection {
  id: string;
  platform: string;
  displayName: string;
  capabilities: string[];
  status: string;
}

interface Snapshot {
  data: ModerationRule[];
  history: ModerationHistory[];
}

function statusLabel(status: ModerationHistory['status'], t: (key: string) => string): string {
  switch (status) {
    case 'pending': return t('modelSurface.moderationPending');
    case 'applied': return t('modelSurface.moderationApplied');
    case 'partial': return t('modelSurface.moderationPartial');
    case 'unknown': return t('modelSurface.moderationUnknown');
    case 'unsupported': return t('modelSurface.moderationUnsupported');
  }
}

export default function CommentModerationPanel({
  modelId,
  connections,
  canEdit,
}: {
  modelId: string;
  connections: Connection[];
  canEdit: boolean;
}) {
  const { locale = 'en', t } = useLocale();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [keywords, setKeywords] = useState('');
  const [action, setAction] = useState<'hide' | 'hide_and_block'>('hide');
  const [connectionId, setConnectionId] = useState('');
  const [postId, setPostId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const scanConnections = useMemo(() => connections.filter(connection =>
    ['connected', 'active'].includes(connection.status)
      && connection.capabilities.includes('comments.read')
      && connection.capabilities.includes('comments.moderate')),
  [connections]);
  const rulePlatforms = useMemo(() => [...new Set(scanConnections.map(connection => connection.platform))], [scanConnections]);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/moderation/rules`, { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const result = await readDashboardJson<Snapshot>(response);
      if (!Array.isArray(result.data) || !Array.isArray(result.history)) throw new Error('invalid response');
      setSnapshot(result);
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, [modelId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!rulePlatforms.includes(platform)) setPlatform(rulePlatforms[0] ?? '');
  }, [platform, rulePlatforms]);
  useEffect(() => {
    if (!scanConnections.some(connection => connection.id === connectionId)) setConnectionId(scanConnections[0]?.id ?? '');
  }, [connectionId, scanConnections]);

  async function mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setNotice('');
    try {
      const response = await mutationFetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        throw new Error(error?.error?.message ?? 'request failed');
      }
      const result = await response.json() as { data?: Record<string, unknown> };
      if (result.data?.scanned !== undefined) {
        const counts = result.data;
        setNotice(t('modelSurface.moderationScanResult')
          .replace('{scanned}', String(counts.scanned ?? 0))
          .replace('{matched}', String(counts.matched ?? 0))
          .replace('{moderated}', String(counts.moderated ?? 0))
          .replace('{partial}', String(counts.partial ?? 0))
          .replace('{unknown}', String(counts.unknown ?? 0))
          .replace('{alreadyRecorded}', String(counts.alreadyRecorded ?? 0)));
        if (Array.isArray(counts.unsupportedRuleIds) && counts.unsupportedRuleIds.length > 0) {
          setNotice(current => `${current} ${t('modelSurface.moderationUnsupportedRules')}`);
        }
      } else {
        setNotice(t('modelSurface.moderationApplied'));
      }
      await load();
      return true;
    } catch {
      setNotice(t('modelSurface.moderationSaveFailed'));
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedKeywords = keywords.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    const saved = await mutate(`/api/v1/models/${encodeURIComponent(modelId)}/moderation/rules`, 'POST', {
      name: name.trim(), platform, keywords: normalizedKeywords, action, enabled: true,
    });
    if (saved) {
      setName('');
      setKeywords('');
    }
  }

  function runScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return mutate(`/api/v1/models/${encodeURIComponent(modelId)}/moderation/scan`, 'POST', {
      connectionId, postId: postId.trim(),
    });
  }

  const ruleName = (ruleId: string) => snapshot?.data.find(rule => rule.id === ruleId)?.name ?? ruleId;
  return <section className="card stack" aria-labelledby="comment-moderation-title">
    <div>
      <h3 id="comment-moderation-title">{t('modelSurface.moderationTitle')}</h3>
      <p className="subtle">{t('modelSurface.moderationDescription')}</p>
    </div>
    {loadState === 'failed' && <p role="alert">{t('modelSurface.moderationLoadFailed')}</p>}
    {scanConnections.length === 0 && <p role="status">{t('modelSurface.moderationNoConnections')}</p>}
    {canEdit && rulePlatforms.length > 0 && <form className="stack" onSubmit={createRule}>
      <label>{t('modelSurface.moderationName')}
        <input required maxLength={120} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label>{t('modelSurface.moderationPlatform')}
        <select required value={platform} onChange={event => setPlatform(event.target.value)}>
          {rulePlatforms.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>{t('modelSurface.moderationKeywords')}
        <textarea required rows={4} maxLength={2_200} value={keywords} onChange={event => setKeywords(event.target.value)} />
      </label>
      <label>{t('modelSurface.moderationAction')}
        <select value={action} onChange={event => setAction(event.target.value as typeof action)}>
          <option value="hide">{t('modelSurface.moderationHide')}</option>
          <option value="hide_and_block">{t('modelSurface.moderationHideBlock')}</option>
        </select>
      </label>
      <button className="btn" type="submit" disabled={busy || !name.trim() || !keywords.trim() || !platform}>
        {t('modelSurface.moderationCreateRule')}
      </button>
    </form>}
    {canEdit && scanConnections.length > 0 && <form className="stack" onSubmit={event => void runScan(event)}>
      <label>{t('modelSurface.moderationPlatform')}
        <select required value={connectionId} onChange={event => setConnectionId(event.target.value)}>
          {scanConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.displayName} ({connection.platform})</option>)}
        </select>
      </label>
      <label>{t('modelSurface.moderationPostId')}
        <input required maxLength={256} value={postId} onChange={event => setPostId(event.target.value)} />
      </label>
      <button className="btn secondary" type="submit" disabled={busy || !connectionId || !postId.trim()}>{t('modelSurface.moderationScan')}</button>
    </form>}
    {snapshot && <>
      <div className="stack">
        <h4>{t('modelSurface.moderationTitle')}</h4>
        {snapshot.data.length === 0 && loadState === 'ready' && <p>{t('modelSurface.moderationEmpty')}</p>}
        {snapshot.data.map(rule => <article className="card stack" key={rule.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><strong>{rule.name}</strong><p className="subtle">{rule.platform} · {rule.action === 'hide' ? t('modelSurface.moderationHide') : t('modelSurface.moderationHideBlock')}</p></div>
            {canEdit && <button type="button" className="btn secondary" disabled={busy} onClick={() => void mutate(
              `/api/v1/models/${encodeURIComponent(modelId)}/moderation/rules/${encodeURIComponent(rule.id)}`,
              'PATCH', { enabled: !rule.enabled },
            )}>{rule.enabled ? t('modelSurface.moderationDisable') : t('modelSurface.moderationEnable')}</button>}
          </div>
          <p>{rule.keywords.join(', ')}</p>
        </article>)}
      </div>
      <div className="stack">
        <h4>{t('modelSurface.moderationHistory')}</h4>
        {snapshot.history.length === 0 && <p>{t('modelSurface.moderationEmpty')}</p>}
        {snapshot.history.map(entry => <article className="card" key={entry.id}>
          <strong>{ruleName(entry.ruleId)}</strong>
          <p>{entry.postId} · {entry.matchedKeywordCount} · {formatDate(new Date(entry.createdAt), locale)}</p>
          <span className={`badge ${entry.status === 'applied' ? 'good' : entry.status === 'partial' || entry.status === 'unknown' ? 'warn' : 'mute'}`}>{statusLabel(entry.status, t)}</span>
        </article>)}
      </div>
    </>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" className="btn secondary" disabled={loadState === 'loading' || busy} onClick={() => void load()}>{t('linkbio.retry')}</button>
  </section>;
}
