'use client';

import { useEffect, useRef, useState } from 'react';
import type { MediaOperation } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import BundleMedia from './BundleMedia';

type OperationStatus = 'queued' | 'running' | 'failed' | 'completed' | 'unknown';

function operationStatus(operation: MediaOperation): OperationStatus {
  const state = operation.state.toLowerCase();
  if (state === 'queued') return 'queued';
  if (state === 'running') return 'running';
  if (state === 'failed') return 'failed';
  if (state === 'completed') return 'completed';
  return 'unknown';
}

function statusLabel(status: OperationStatus): string {
  return status === 'unknown' ? 'Status unavailable' : `${status[0].toUpperCase()}${status.slice(1)}`;
}

function statusDescription(status: OperationStatus): string {
  switch (status) {
    case 'queued':
      return 'Waiting for the media worker.';
    case 'running':
      return 'The media worker is processing this operation.';
    case 'failed':
      return 'The transform failed. Review the operation and retry if appropriate.';
    case 'completed':
      return 'The transformed asset is saved and still requires its own review.';
    default:
      return 'Refresh status before taking another action.';
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
}: {
  operations: MediaOperation[];
  modelId: string;
  canEdit: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshError: string;
  onRetry: (operation: MediaOperation) => void;
  retryingId: string | null;
}) {
  if (operations.length === 0) return null;
  return (
    <div className="stack" aria-label="Media transform status">
      <div className="action-row">
        <strong>Transform history</strong>
        <button className="btn secondary" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>
      {refreshError && <p role="alert">{refreshError}</p>}
      {operations.map((operation) => {
        const status = operationStatus(operation);
        return (
          <div className="stack" key={operation.id} data-operation-state={status}>
            <p className="subtle">
              <strong>{operation.type}</strong> · <span aria-label={`${statusLabel(status)} transform status`}>{statusLabel(status)}</span>
            </p>
            <p className="subtle">{statusDescription(status)}</p>
            {status === 'failed' && canEdit && (
              <button
                className="btn secondary"
                type="button"
                disabled={retryingId === operation.id}
                onClick={() => onRetry(operation)}
              >
                {retryingId === operation.id ? 'Retrying…' : 'Retry transform'}
              </button>
            )}
            {status === 'completed' && operation.outputAssetId && (
              <details>
                <summary>View transformed result</summary>
                <BundleMedia modelId={modelId} assetId={operation.outputAssetId} />
                <p className="subtle">
                  Saved in the media library. This result has not inherited approval from its source.
                </p>
              </details>
            )}
            {status === 'completed' && !operation.outputAssetId && (
              <p className="subtle">Completed, but the output asset is not available yet. Refresh status.</p>
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
      setRefreshError('Transformation status could not be refreshed. Try again.');
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
        setRefreshError((await readDashboardError(response)).error?.message ?? 'Transform retry was not queued.');
        return;
      }
      const result = await readDashboardJson<{ data?: MediaOperation }>(response);
      if (!result.data?.id) throw new Error('unconfirmed transform retry');
      setLiveOperations((current) => [result.data as MediaOperation, ...current]);
    } catch {
      setRefreshError('Transform retry was not confirmed. Refresh status before trying again.');
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
      setError('Enter valid transform values.');
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
        setError(details?.error?.message ?? 'Transform was not queued.');
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        return;
      }
      const result = await readDashboardJson<{ data?: MediaOperation }>(response);
      if (!result.data?.id) throw new Error('unconfirmed transform response');
      setLiveOperations((current) => [result.data as MediaOperation, ...current]);
      intent.current = null;
    } catch {
      setError('Transform queueing was not confirmed. Retry the same request.');
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
  };

  if (!canEdit)
    return (
      <div className="stack">
        <p className="subtle">Media transforms require an owner, manager, or operator role.</p>
        <OperationResults {...statusProps} />
      </div>
    );
  return (
    <details>
      <summary>Clip, resize, or adapt media</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <p className="subtle">
          The result is saved as a variant and must still pass the normal ToS and approval workflow.
        </p>
        <div className="row">
          <label>
            Operation
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {kind === 'image' ? (
                <>
                  <option value="image_resize">Resize image</option>
                  <option value="image_clip">Crop image</option>
                </>
              ) : (
                <>
                  <option value="video_clip">Clip video</option>
                  <option value="video_transcode">Transcode video</option>
                </>
              )}
            </select>
          </label>
          {type === 'video_transcode' ? (
            <label>
              Format
              <select value={targetFormat} onChange={(event) => setTargetFormat(event.target.value)}>
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </label>
          ) : type === 'video_clip' ? (
            <>
              <label>
                Start seconds
                <input type="number" min="0" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label>
                Duration seconds
                <input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label>
                Width
                <input type="number" min="1" value={width} onChange={(event) => setWidth(event.target.value)} />
              </label>
              <label>
                Height
                <input type="number" min="1" value={height} onChange={(event) => setHeight(event.target.value)} />
              </label>
              {type === 'image_clip' && (
                <>
                  <label>
                    X
                    <input type="number" min="0" value={x} onChange={(event) => setX(event.target.value)} />
                  </label>
                  <label>
                    Y
                    <input type="number" min="0" value={y} onChange={(event) => setY(event.target.value)} />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <button className="btn secondary" type="button" disabled={busy || !!intent.current} onClick={() => void submit()}>
          {busy ? 'Queueing…' : 'Queue transform'}
        </button>
        {intent.current && (
          <button className="btn secondary" type="button" disabled={busy} onClick={() => void submit()}>
            Retry same transform
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        <OperationResults {...statusProps} />
      </div>
    </details>
  );
}
