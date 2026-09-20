'use client';

import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function MediaUpload({ modelId, onUploaded }: {
  modelId: string; onUploaded?: (asset: { id: string; mimeType: string }) => void;
}) {
  const { t } = useLocale();
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
      setMessage(t('media.chooseValid')); return;
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
        setMessage(typeof detail === 'string' ? detail : t('media.uploadNotConfirmed'));
        if (failure.code === 'ASSET_UPLOAD_NOT_STORED') { intent.current = null; setPending(false); }
        return;
      }
      const { data } = await readDashboardJson<{ data: { id: string; mimeType: string; sanitized: boolean; exactFileHashChanged: boolean } }>(response);
      if (!data || !/^[0-9a-f-]{36}$/i.test(data.id) || data.sanitized !== saved.sanitize
        || typeof data.exactFileHashChanged !== 'boolean' || (!saved.sanitize && data.exactFileHashChanged)
        || !['image/png', 'image/jpeg', 'video/mp4'].includes(data.mimeType)) throw new Error('Invalid upload response');
      setMessage(t('media.storedAsset', {
        id: data.id,
        sanitizedText: data.sanitized ? t('media.sanitizedSuffix') : '',
        hashState: data.exactFileHashChanged ? t('media.hashChanged') : t('media.hashUnchanged'),
        notScanned: t('media.notScanned'),
      }));
      if (onUploaded) onUploaded(data); else window.location.reload();
      intent.current = null; setFile(null); setPending(false);
      setFileInputVersion(fileInputVersion + 1);
    } catch { setMessage(t('media.uploadUnconfirmed')); }
    finally { active.current = false; setBusy(false); }
  }
  return <section className="card" aria-label={t('media.uploadSection')}>
    <h3>{t('media.uploadSource')}</h3>
    <input key={fileInputVersion} aria-label={t('media.file')} type="file" accept="image/jpeg,image/png,video/mp4" disabled={busy || pending}
      onChange={event => setFile(event.target.files?.[0] ?? null)} />
    <label className="checkbox-option"><input type="checkbox" checked={sanitize} disabled={busy || pending}
      onChange={event => setSanitize(event.target.checked)} /><span>{t('media.removeMetadata')}</span></label>
    <p>{t('media.uploadLimits')}</p>
    <button type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? t('media.uploading') : pending ? t('media.checkSameUpload') : t('media.upload')}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
