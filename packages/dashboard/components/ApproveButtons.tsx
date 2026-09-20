'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { approvalSlot } from '@/lib/schedule';
import type { SocialConnection } from '@/lib/api';
import { useLocale } from './LocaleProvider';

const PLATFORMS = [
  'instagram',
  'tiktok',
  'x',
  'youtube',
  'reddit',
  'threads',
  'discord',
  'telegram',
  'facebook',
  'snapchat',
  'fanvue',
];

export default function ApproveButtons({
  bundleId,
  tosBlocked,
  connections,
  revisionId,
  platforms,
}: {
  bundleId: string;
  tosBlocked: boolean;
  connections: SocialConnection[];
  revisionId?: string;
  platforms: string[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const availablePlatforms = PLATFORMS.filter((platform) => platforms.includes(platform));
  const [selected, setSelected] = useState<string[]>(() => availablePlatforms.slice(0, 1));
  const [connectionIds, setConnectionIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      availablePlatforms.flatMap((platform) => {
        const candidates = connections.filter(
          (connection) =>
            connection.platform === platform &&
            (connection.status === 'connected' || connection.status === 'active'),
        );
        return candidates.length === 1 ? [[platform, candidates[0].id]] : [];
      }),
    ),
  );
  const [slot, setSlot] = useState('');
  const [instructions, setInstructions] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{
    path: string;
    body: string;
    key: string;
    scheduledSlot?: string;
  } | null>(null);

  function toggle(p: string) {
    setSelected((prev) => {
      if (prev.includes(p)) return prev.filter((x) => x !== p);
      if (!connectionIds[p]) {
        const candidates = connections.filter(
          (connection) =>
            connection.platform === p &&
            (connection.status === 'connected' || connection.status === 'active'),
        );
        if (candidates.length === 1)
          setConnectionIds((current) => ({ ...current, [p]: candidates[0].id }));
      }
      return [...prev, p];
    });
  }

  const selectedWithoutConnection = selected.filter((platform) => !connectionIds[platform]);
  const pendingAction = intent.current?.path.split('/').at(-1);
  const inputsLocked = busy || Boolean(intent.current);

  async function act(action: 'approve' | 'revise' | 'reject') {
    if (inFlight.current) return;
    const path = `/api/v1/bundles/${bundleId}/${action}`;
    if (intent.current && intent.current.path !== path) {
      setError(t('review.actionConflict'));
      return;
    }
    if (!intent.current && action === 'approve' && (tosBlocked || selected.length === 0 || selectedWithoutConnection.length > 0)) return;
    let scheduledSlot: string | undefined;
    if (action === 'approve') {
      try {
        // A previously submitted request may have succeeded before its response
        // was lost. Recover that exact request even if the slot or revision has
        // changed; do not authorize a second action until it is resolved.
        scheduledSlot = intent.current
          ? intent.current.scheduledSlot
          : approvalSlot(slot);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('review.invalidSchedule'));
        return;
      }
    }
    if (!intent.current && action === 'revise' && !instructions.trim()) {
      setError(t('review.revisionInstructionsRequired'));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const send = (body: string) => {
        if (!intent.current) {
          intent.current = { path, body, key: createIdempotencyKey(), scheduledSlot };
        }
        return mutationFetch(path, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
        }, { idempotencyKey: intent.current.key });
      };
      let res: Response;
      if (action === 'approve') {
        res = await send(JSON.stringify({
            platforms: selected,
            revisionId,
            slot: scheduledSlot,
            connectionIds: Object.fromEntries(
              selected
                .filter((platform) => connectionIds[platform])
                .map((platform) => [platform, connectionIds[platform]]),
            ),
          }));
      } else if (action === 'revise') {
        res = await send(JSON.stringify({ instructions: instructions.trim(), revisionId }));
      } else {
        res = await send(JSON.stringify({ revisionId }));
      }
      if (!res.ok) {
        const b = await readDashboardError(res);
        if (res.status === 400 || res.status === 422) intent.current = null;
        setError(typeof b?.detail === 'string' ? b.detail : b?.error?.message ?? t('review.actionFailed'));
        return;
      }
      const receipt = await readDashboardJson<{ data?: {
        id?: unknown; state?: unknown; tosReport?: { verdict?: unknown; revisionId?: unknown };
      } } | null>(res);
      const result = receipt?.data;
      const expectedState = { approve: 'approved', revise: 'revising', reject: 'rejected' }[action];
      const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      if (!result || result.id !== bundleId || typeof result.id !== 'string' || !uuid.test(result.id)
        || result.state !== expectedState
        || (action === 'revise' && (result.tosReport?.verdict !== 'pending'
          || typeof result.tosReport.revisionId !== 'string' || !uuid.test(result.tosReport.revisionId)))) {
        throw new Error('Unconfirmed review action receipt');
      }
      intent.current = null;
      if (action === 'revise')
        setNotice(
          t('review.revisionQueued'),
        );
      router.refresh();
    } catch {
      setError(t('review.actionUnconfirmed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {availablePlatforms.map((p) => (
          <button
            key={p}
            type="button"
            disabled={inputsLocked}
            className={`btn ${selected.includes(p) ? '' : 'secondary'}`}
            aria-pressed={selected.includes(p)}
            onClick={() => toggle(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {availablePlatforms.length === 0 && (
        <p role="status">{t('review.noDestinations')}</p>
      )}
      <div className="row">
        <label className="field-stack" style={{ margin: 0 }}>
          {t('review.slotLocalTime')}
          <small style={{ display: 'block' }}>
            {t('review.dstRepeatedHour')}
          </small>
          <input
            type="datetime-local"
            disabled={inputsLocked}
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
          />
        </label>
      </div>
      {selected.map((platform) => {
        const available = connections.filter(
          (connection) =>
            connection.platform === platform &&
            (connection.status === 'connected' || connection.status === 'active'),
        );
        return (
          <label key={platform} className="field-stack" style={{ margin: 0 }}>
            {t('review.account', { platform })}
            <select
              disabled={inputsLocked}
              value={connectionIds[platform] ?? ''}
              onChange={(event) =>
                setConnectionIds((current) => ({ ...current, [platform]: event.target.value }))
              }
            >
              <option value="">{t('review.selectAccount')}</option>
              {available.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.displayName}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {selectedWithoutConnection.length > 0 && (
        <p style={{ color: 'var(--bad)', margin: 0 }}>
          {t('review.connectAccount', { platforms: selectedWithoutConnection.join(', ') })}
        </p>
      )}
      {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pendingAction && <p role="status">{t('review.pendingAction')}</p>}
      <label className="field-stack">
        {t('review.captionInstructions')}
        <textarea
          value={instructions}
          maxLength={2000}
          disabled={inputsLocked}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t('review.captionInstructionsPlaceholder')}
        />
      </label>
      <div className="action-row">
        <button
          className="btn"
          type="button"
          disabled={
            busy || (pendingAction ? pendingAction !== 'approve' : tosBlocked || selected.length === 0 || selectedWithoutConnection.length > 0)
          }
          onClick={() => act('approve')}
        >
          {pendingAction === 'approve' ? t('review.checkApproval') : tosBlocked ? t('review.blockedByTos') : t('review.approve')}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || (pendingAction ? pendingAction !== 'revise' : !instructions.trim())}
          onClick={() => act('revise')}
        >
          {pendingAction === 'revise' ? t('review.checkRevision') : t('review.reviseCaptions')}
        </button>
        <button className="btn danger" type="button" disabled={busy || Boolean(pendingAction && pendingAction !== 'reject')} onClick={() => act('reject')}>
          {pendingAction === 'reject' ? t('review.checkRejection') : t('review.reject')}
        </button>
      </div>
    </div>
  );
}
