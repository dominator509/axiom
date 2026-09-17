'use client';

import { useRef, useState } from 'react';
import type { MediaOperation } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import BundleMedia from './BundleMedia';

function OperationResults({
  operations,
  modelId,
}: {
  operations: MediaOperation[];
  modelId: string;
}) {
  return (
    <div className="stack">
      {operations.map((operation) => (
        <div className="stack" key={operation.id}>
          <p className="subtle">
            {operation.type}: {operation.state}
            {operation.error ? ` · ${operation.error}` : ''}
          </p>
          {operation.state === 'completed' && operation.outputAssetId && (
            <details>
              <summary>View transformed result</summary>
              <BundleMedia modelId={modelId} assetId={operation.outputAssetId} />
              <p className="subtle">
                Saved in the media library. This result has not inherited approval from its source.
              </p>
            </details>
          )}
        </div>
      ))}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<{ body: string; key: string } | null>(null);
  const own = operations.filter((operation) => operation.sourceAssetId === assetId);

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
    if (
      !Object.values(body).every((value) => typeof value === 'string' || Number.isFinite(value))
    ) {
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
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (!result.data) throw new Error('unconfirmed transform response');
      intent.current = null;
      window.location.reload();
    } catch {
      setError('Transform queueing was not confirmed. Retry the same request.');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit)
    return (
      <div className="stack">
        <p className="subtle">Media transforms require an owner, manager, or operator role.</p>
        <OperationResults operations={own} modelId={modelId} />
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
              <select
                value={targetFormat}
                onChange={(event) => setTargetFormat(event.target.value)}
              >
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </label>
          ) : type === 'video_clip' ? (
            <>
              <label>
                Start seconds
                <input
                  type="number"
                  min="0"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label>
                Duration seconds
                <input
                  type="number"
                  min="1"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Width
                <input
                  type="number"
                  min="1"
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min="1"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                />
              </label>
              {type === 'image_clip' && (
                <>
                  <label>
                    X
                    <input
                      type="number"
                      min="0"
                      value={x}
                      onChange={(event) => setX(event.target.value)}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      type="number"
                      min="0"
                      value={y}
                      onChange={(event) => setY(event.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || !!intent.current}
          onClick={() => void submit()}
        >
          {busy ? 'Queueing…' : 'Queue transform'}
        </button>
        {intent.current && (
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={() => void submit()}
          >
            Retry same transform
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        <OperationResults operations={own} modelId={modelId} />
      </div>
    </details>
  );
}
