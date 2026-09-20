'use client';

import { useEffect, useRef, useState } from 'react';
import type { MediaOperation } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import BundleMedia from './BundleMedia';
import { useLocale } from './LocaleProvider';

type OperationStatus = 'queued' | 'running' | 'failed' | 'completed' | 'unknown';
type Translate = (key: string, values?: Record<string, string | number>) => string;

function operationStatus(operation: MediaOperation): OperationStatus {
  const state = operation.state.toLowerCase();
  if (state === 'queued') return 'queued';
  if (state === 'running') return 'running';
  if (state === 'failed') return 'failed';
  if (state === 'completed') return 'completed';
  return 'unknown';
}

function statusLabel(status: OperationStatus, t: Translate): string {
  if (status === 'queued') return t('media.lifecycleQueued');
  if (status === 'running') return t('media.lifecycleRunning');
  if (status === 'failed') return t('media.lifecycleFailed');
  if (status === 'completed') return t('media.lifecycleCompleted');
  return t('media.lifecycleUnavailable');
}

function statusDescription(status: OperationStatus, t: Translate): string {
  switch (status) {
    case 'queued':
      return t('media.lifecycleQueuedDetail');
    case 'running':
      return t('media.lifecycleRunningDetail');
    case 'failed':
      return t('media.lifecycleFailedDetail');
    case 'completed':
      return t('media.lifecycleCompletedDetail');
    default:
      return t('media.lifecycleUnavailableDetail');
  }
}

function OperationResults({
  operations,
  modelId,
  canEdit,
  onRefresh,
  refreshing,
  refreshError,
  onRetry,
  retryingId,
  t,
}: {
  operations: MediaOperation[];
  modelId: string;
  canEdit: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshError: string;
  onRetry: (operation: MediaOperation) => void;
  retryingId: string | null;
  t: Translate;
}) {
  if (operations.length === 0) return null;
  return (
    <div className="stack" aria-label={t('review.transformHistory')}>
      <div className="action-row">
        <strong>{t('review.transformHistory')}</strong>
        <button className="btn secondary" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? t('review.refreshingStatus') : t('review.refreshStatus')}
        </button>
      </div>
      {refreshError && <p role="alert">{refreshError}</p>}
      {operations.map((operation) => {
        const status = operationStatus(operation);
        return (
          <div className="stack" key={operation.id} data-operation-state={status}>
            <p className="subtle">
              <strong>{operation.type}</strong> · <span aria-label={t('review.transformStatusAria', { status: statusLabel(status, t) })}>{statusLabel(status, t)}</span>
            </p>
            <p className="subtle">{statusDescription(status, t)}</p>
            {status === 'failed' && canEdit && (
              <button
                className="btn secondary"
                type="button"
                disabled={retryingId === operation.id}
                onClick={() => onRetry(operation)}
              >
                {retryingId === operation.id ? t('review.retryingTransform') : t('review.retryTransform')}
              </button>
            )}
            {status === 'completed' && operation.outputAssetId && (
              <details>
                <summary>{t('review.viewTransformedResult')}</summary>
                <BundleMedia modelId={modelId} assetId={operation.outputAssetId} />
                <p className="subtle">
                  {t('review.transformSavedRequiresReview')}
                </p>
              </details>
            )}
            {status === 'completed' && !operation.outputAssetId && (
              <p className="subtle">{t('review.transformOutputUnavailable')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MediaOperationControls({
  modelId,
  assetId,
  kind,
  operations,
  canEdit,
}: {
  modelId: string;
  assetId: string;
  kind: string;
  operations: MediaOperation[];
  canEdit: boolean;
}) {
  const { t } = useLocale();
  const [type, setType] = useState(kind === 'video' ? 'video_clip' : 'image_resize');
  const [width, setWidth] = useState('1080');
  const [height, setHeight] = useState('1350');
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [start, setStart] = useState('0');
  const [duration, setDuration] = useState('10');
  const [targetFormat, setTargetFormat] = useState('mp4');
  const [liveOperations, setLiveOperations] = useState(operations);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const intent = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    setLiveOperations(operations);
  }, [operations]);

  const own = liveOperations.filter((operation) => operation.sourceAssetId === assetId);

  async function refreshOperations() {
    if (refreshing) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setRefreshing(true);
    setRefreshError('');
    try {
      const response = await fetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/media-operations`,
        { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
      );
      if (!response.ok) throw new Error('status refresh failed');
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (!Array.isArray(result.data)) throw new Error('invalid status response');
      setLiveOperations(result.data as MediaOperation[]);
    } catch {
      setRefreshError(t('review.transformStatusRefreshFailed'));
    } finally {
      window.clearTimeout(timeout);
      setRefreshing(false);
    }
  }

  async function retryOperation(operation: MediaOperation) {
    if (retryingId || !operation.options || typeof operation.options !== 'object') return;
    setRetryingId(operation.id);
    setRefreshError('');
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/media-operations?assetId=${encodeURIComponent(assetId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(operation.options),
        },
        { idempotencyKey: createIdempotencyKey(), retries: 0 },
      );
      if (!response.ok) {
        setRefreshError((await readDashboardError(response)).error?.message ?? t('review.transformRetryNotQueued'));
        return;
      }
      const result = await readDashboardJson<{ data?: MediaOperation }>(response);
      if (!result.data?.id) throw new Error('unconfirmed transform retry');
      setLiveOperations((current) => [result.data as MediaOperation, ...current]);
    } catch {
      setRefreshError(t('review.transformRetryUnconfirmed'));
    } finally {
      setRetryingId(null);
    }
  }

  async function submit() {
    if (busy) return;
    const numeric = (value: string) => Number(value);
    const body =
      type === 'image_resize'
        ? { type, width: numeric(width), height: numeric(height) }
        : type === 'image_clip'
          ? { type, x: numeric(x), y: numeric(y), width: numeric(width), height: numeric(height) }
          : type === 'video_clip'
            ? { type, start: numeric(start), duration: numeric(duration) }
            : { type, targetFormat };
    if (!Object.values(body).every((value) => typeof value === 'string' || Number.isFinite(value))) {
      setError(t('review.transformValuesInvalid'));
      return;
    }
    intent.current ??= { body: JSON.stringify(body), key: createIdempotencyKey() };
    setBusy(true);
    setError('');
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/media-operations?assetId=${encodeURIComponent(assetId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: intent.current.body,
        },
        { idempotencyKey: intent.current.key, retries: 0 },
      );
      if (!response.ok) {
        const details = await readDashboardError(response);
        setError(details?.error?.message ?? t('review.transformNotQueued'));
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        return;
      }
      const result = await readDashboardJson<{ data?: MediaOperation }>(response);
      if (!result.data?.id) throw new Error('unconfirmed transform response');
      setLiveOperations((current) => [result.data as MediaOperation, ...current]);
      intent.current = null;
    } catch {
      setError(t('review.transformQueueUnconfirmed'));
    } finally {
      setBusy(false);
    }
  }

  const statusProps = {
    operations: own,
    modelId,
    canEdit,
    onRefresh: () => void refreshOperations(),
    refreshing,
    refreshError,
    onRetry: (operation: MediaOperation) => void retryOperation(operation),
    retryingId,
    t,
  };

  if (!canEdit)
    return (
      <div className="stack">
        <p className="subtle">{t('review.transformRoleRequired')}</p>
        <OperationResults {...statusProps} />
      </div>
    );
  return (
    <details>
      <summary>{t('review.transformSummary')}</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <p className="subtle">
          {t('review.transformSafety')}
        </p>
        <div className="row">
          <label>
            {t('review.operation')}
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {kind === 'image' ? (
                <>
                  <option value="image_resize">{t('review.resizeImage')}</option>
                  <option value="image_clip">{t('review.cropImage')}</option>
                </>
              ) : (
                <>
                  <option value="video_clip">{t('review.clipVideo')}</option>
                  <option value="video_transcode">{t('review.transcodeVideo')}</option>
                </>
              )}
            </select>
          </label>
          {type === 'video_transcode' ? (
            <label>
              {t('review.format')}
              <select value={targetFormat} onChange={(event) => setTargetFormat(event.target.value)}>
                <option value="mp4">{t('review.mp4')}</option>
                <option value="webm">{t('review.webm')}</option>
              </select>
            </label>
          ) : type === 'video_clip' ? (
            <>
              <label>
                {t('review.startSeconds')}
                <input type="number" min="0" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label>
                {t('review.durationSeconds')}
                <input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label>
                {t('review.width')}
                <input type="number" min="1" value={width} onChange={(event) => setWidth(event.target.value)} />
              </label>
              <label>
                {t('review.height')}
                <input type="number" min="1" value={height} onChange={(event) => setHeight(event.target.value)} />
              </label>
              {type === 'image_clip' && (
                <>
                  <label>
                    {t('review.xOffset')}
                    <input type="number" min="0" value={x} onChange={(event) => setX(event.target.value)} />
                  </label>
                  <label>
                    {t('review.yOffset')}
                    <input type="number" min="0" value={y} onChange={(event) => setY(event.target.value)} />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <button className="btn secondary" type="button" disabled={busy || !!intent.current} onClick={() => void submit()}>
          {busy ? t('review.queueingTransform') : t('review.queueTransform')}
        </button>
        {intent.current && (
          <button className="btn secondary" type="button" disabled={busy} onClick={() => void submit()}>
            {t('review.retrySameTransform')}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        <OperationResults {...statusProps} />
      </div>
    </details>
  );
}
