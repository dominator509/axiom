'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export default function MediaUpload({ modelId, onUploaded }: {
  modelId: string; onUploaded: (asset: { id: string; mimeType: string }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sanitize, setSanitize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const active = useRef(false);
  const intent = useRef<{ file: File; sanitize: boolean; key: string } | null>(null);
  async function upload() {
    if (active.current || !file) return;
    if (!['image/jpeg', 'image/png', 'video/mp4'].includes(file.type)
      || file.size < 12 || file.size > (file.type === 'video/mp4' ? 64 : 20) * 1024 * 1024) {
      setMessage('Choose JPEG/PNG up to 20 MB or MP4 up to 64 MB.'); return;
    }
    active.current = true; setBusy(true); setPending(true); setMessage('');
    intent.current ??= { file, sanitize, key: createIdempotencyKey() };
    const saved = intent.current;
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/media-upload?sanitize=${saved.sanitize}`, {
        method: 'POST', headers: { 'content-type': saved.file.type }, body: saved.file,
      }, { idempotencyKey: saved.key, retries: 0, timeoutMs: 660_000 });
      if (!response.ok) {
        const failure = await readDashboardError(response);
        const detail = failure?.error?.message ?? failure.detail;
        setMessage(typeof detail === 'string' ? detail : 'Upload not confirmed. Check the same request.');
        if (failure.code === 'ASSET_UPLOAD_NOT_STORED') { intent.current = null; setPending(false); }
        return;
      }
      const { data } = await readDashboardJson<{ data: { id: string; mimeType: string; sanitized: boolean; exactFileHashChanged: boolean } }>(response);
      if (!data || !/^[0-9a-f-]{36}$/i.test(data.id) || data.sanitized !== saved.sanitize
        || typeof data.exactFileHashChanged !== 'boolean' || (!saved.sanitize && data.exactFileHashChanged)
        || !['image/png', 'image/jpeg', 'video/mp4'].includes(data.mimeType)) throw new Error('Invalid upload response');
      setMessage(`Stored asset ${data.id}${data.sanitized ? ' with embedded metadata and C2PA removed' : ''}. Exact-file SHA-256 ${data.exactFileHashChanged ? 'changed' : 'unchanged'}. This does not prevent perceptual matching. Not yet ToS-scanned or approved.`);
      onUploaded(data); intent.current = null; setFile(null); setPending(false);
      setFileInputVersion(fileInputVersion + 1);
    } catch { setMessage('Upload outcome unconfirmed. Check the same request before uploading again.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <section className="card" aria-label="Upload media">
    <h3>Upload source media</h3>
    <input key={fileInputVersion} aria-label="Media file" type="file" accept="image/jpeg,image/png,video/mp4" disabled={busy || pending}
      onChange={event => setFile(event.target.files?.[0] ?? null)} />
    <label><input type="checkbox" checked={sanitize} disabled={busy || pending}
      onChange={event => setSanitize(event.target.checked)} /> Remove metadata and embedded provenance, including C2PA (optional)</label>
    <p>JPEG/PNG up to 20 MB; MP4 up to 64 MB. Cleaning converts images to PNG and re-encodes video. Existing watermarks remain. No publishing or generation occurs.</p>
    <button type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? 'Uploading and processing…' : pending ? 'Check same upload' : 'Upload media'}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
