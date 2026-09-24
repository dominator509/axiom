'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNumber } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import GenerationProgress from './GenerationProgress';
import GrokConnection from './GrokConnection';
import MediaUpload from './MediaUpload';
import GeneratedCaptionReceipt from './GeneratedCaptionReceipt';
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

export default function GenerateForm({ modelId, initialSourceAssetId = '', operatorControls = true }: { modelId: string; initialSourceAssetId?: string; operatorControls?: boolean }) {
  const { locale = 'en', t } = useLocale();
  const router = useRouter();
  const [style, setStyle] = useState('studio');
  const [outfit, setOutfit] = useState('summer dress');
  const [location, setLocation] = useState('studio');
  const [mood, setMood] = useState('energetic');
  const [lighting, setLighting] = useState('soft studio');
  const [aspectRatio, setAspectRatio] = useState('3:4');
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [enrich, setEnrich] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bundle?: { id: string; modelId: string; captions?: Record<string, string> };
    captionEnrichment?: Record<string, 'enriched' | 'fallback' | 'not_requested'>;
    mediaGeneration?: 'queued';
    variants: Array<{ prompt: string; styleLabel: string; caption: string; hashtags: string[] }>;
    tosReport: {
      verdict: string;
      scores: Array<{ platform: string; verdict: string; score: number }>;
    };
  } | null>(null);
  const [mediaKind, setMediaKind] = useState<'brief' | 'image' | 'video'>(initialSourceAssetId ? 'video' : 'brief');
  const [mediaPrompt, setMediaPrompt] = useState('');
  const [sourceAssetId, setSourceAssetId] = useState(initialSourceAssetId);
  const [duration, setDuration] = useState<6 | 10>(6);
  const [sourceImages, setSourceImages] = useState<Array<{ id: string; fileName: string }>>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sanitizeMetadata, setSanitizeMetadata] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<{ modelId: string; body: string; key: string } | null>(null);

  useEffect(() => {
    setSourceAssetId(initialSourceAssetId);
    setSourceImages([]);
    setSourceError(null);
    if (mediaKind !== 'video') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/models/${modelId}/media-source-images`, { signal: controller.signal });
        if (!response.ok) throw new Error(t('generation.sourceImagesUnavailable'));
        const body = await readDashboardJson<{ data: Array<{ id: string; fileName: string }> }>(response);
        if (!controller.signal.aborted) setSourceImages(body.data);
      } catch {
        if (!controller.signal.aborted) setSourceError(t('generation.sourceImagesUnavailable'));
      }
    })();
    return () => controller.abort();
  }, [modelId, mediaKind, initialSourceAssetId]);

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (intent.current && intent.current.modelId !== modelId) {
      setError(t('generation.originalModel'));
      return;
    }
    if (!intent.current) {
      const invalid = platforms.length === 0 ? t('generation.selectPlatform')
        : mediaKind !== 'brief' && !mediaPrompt.trim() ? t('generation.promptRequired')
          : mediaKind === 'video' && !sourceAssetId ? t('generation.sourceImageRequired')
            : null;
      if (invalid) { setError(invalid); return; }
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Server defaults apply to absent keys, not cleared or whitespace-only inputs.
      // Preserve nonblank values and the existing immutable retry payload.
      const cleaned = Object.fromEntries(
        Object.entries({ style, outfit, location, mood, lighting })
          .filter(([, value]) => value.trim().length > 0),
      );
      const requestBody = JSON.stringify({
        ...cleaned, aspectRatio, platforms, enrichWithLlm: enrich,
        ...(mediaKind === 'brief' ? {} : { media: {
          kind: mediaKind, prompt: mediaPrompt.trim(),
          ...(sanitizeMetadata ? { sanitizeMetadata: true } : {}),
          ...(mediaKind === 'image' ? { aspectRatio } : {}),
          ...(mediaKind === 'video' ? { sourceAssetId, duration } : {}),
        } }),
      });
      if (!intent.current) {
        intent.current = { modelId, body: requestBody, key: createIdempotencyKey() };
      }
      const res = await mutationFetch(`/api/v1/models/${modelId}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: intent.current.body,
      }, { idempotencyKey: intent.current.key });
      if (!res.ok) {
        const b = await readDashboardError(res);
        const message = b?.error?.message ?? b?.detail;
        setError(typeof message === 'string' ? message : t('generation.failed'));
        // An uncertain response is not permission to queue a new paid request.
        // Preserve its exact body/key until reconciliation. An expired session
        // or revoked access on a later check cannot disprove earlier acceptance.
        // Only input-validation rejection permits a corrected request here.
        if ([400, 422].includes(res.status))
          intent.current = null;
        return;
      }
      const body = await readDashboardJson<{ data: typeof result }>(res);
      const receipt = body?.data;
      const queuedMedia = !!JSON.parse(intent.current.body).media;
      // A 2xx status alone cannot resolve a possibly paid generation. Validate
      // the receipt before discarding the only key that can recover its result.
      if (!receipt || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.bundle?.id ?? '')
        || receipt.bundle?.modelId !== intent.current.modelId
        || !Array.isArray(receipt.variants) || receipt.variants.some(variant => !variant
          || typeof variant.prompt !== 'string' || typeof variant.caption !== 'string'
          || typeof variant.styleLabel !== 'string' || !Array.isArray(variant.hashtags)
          || variant.hashtags.some(tag => typeof tag !== 'string'))
        || !receipt.tosReport || !['pending', 'pass', 'review', 'block'].includes(receipt.tosReport.verdict)
        || !Array.isArray(receipt.tosReport.scores) || receipt.tosReport.scores.some(score => !score
          || typeof score.platform !== 'string' || !['pass', 'review', 'block'].includes(score.verdict)
          || !Number.isFinite(score.score))
        || (queuedMedia ? receipt.mediaGeneration !== 'queued' || receipt.tosReport.verdict !== 'pending'
          : receipt.mediaGeneration !== undefined)) throw new Error('Invalid generation receipt');
      setResult(receipt);
      intent.current = null;
      router.refresh();
    } catch {
      setError(t('generation.unconfirmed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{t('generation.createBrief')}</h2>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>{t('generation.description')}</p>
      <GrokConnection />
      <MediaUpload modelId={modelId} onUploaded={asset => {
        if (asset.mimeType.startsWith('image/')) {
          setSourceImages(previous => [{ id: asset.id, fileName: t('generation.uploadedImage', { id: asset.id }) }, ...previous]);
          setSourceAssetId(asset.id);
        }
        router.refresh();
      }} />
      <form noValidate onSubmit={onSubmit} className="stack" style={{ maxWidth: 640 }}>
        <fieldset disabled={busy || !!intent.current} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label htmlFor="mediaKind">{t('generation.output')}</label>
        <select id="mediaKind" value={mediaKind} onChange={e => setMediaKind(e.target.value as 'brief' | 'image' | 'video')}>
          <option value="brief">{t('generation.briefOnly')}</option>
          <option value="image">{t('generation.image')}</option>
          <option value="video">{t('generation.imageToVideo')}</option>
        </select>
        {mediaKind !== 'brief' && <>
          <label htmlFor="mediaPrompt">{t('generation.mediaPrompt')}</label>
          <textarea id="mediaPrompt" required maxLength={4000} value={mediaPrompt} onChange={e => setMediaPrompt(e.target.value)} />
          <label className="checkbox-option"><input type="checkbox" checked={sanitizeMetadata} onChange={e => setSanitizeMetadata(e.target.checked)} /><span>{t('generation.sanitizeMetadata')}</span></label>
          <p>{t('generation.sanitizeDescription')}</p>
        </>}
        {mediaKind === 'video' && <>
          <label htmlFor="sourceAsset">{t('generation.sourceImageLatest')}</label>
          <select id="sourceAsset" required value={sourceAssetId} onChange={e => setSourceAssetId(e.target.value)}>
            <option value="">{t('generation.selectStoredImage')}</option>
            {sourceImages.map(image => <option key={image.id} value={image.id}>{image.fileName}</option>)}
          </select>
          {sourceError && <p role="alert">{sourceError}</p>}
          {!sourceError && sourceImages.length === 0 && <p>{t('generation.noSourceImages')}</p>}
          {sourceAssetId && <a href={`/api/v1/models/${encodeURIComponent(modelId)}/media/${encodeURIComponent(sourceAssetId)}`} target="_blank" rel="noopener noreferrer">{t('generation.openSourceImage')}</a>}
          <label htmlFor="videoDuration">{t('generation.videoDuration')}</label>
          <select id="videoDuration" value={duration} onChange={e => setDuration(Number(e.target.value) as 6 | 10)}>
            <option value={6}>{t('generation.seconds', { seconds: 6 })}</option><option value={10}>{t('generation.seconds', { seconds: 10 })}</option>
          </select>
        </>}
        <div className="grid">
          <div>
            <label htmlFor="style">{t('generation.style')}</label>
            <input id="style" value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="outfit">{t('generation.outfit')}</label>
            <input id="outfit" value={outfit} onChange={(e) => setOutfit(e.target.value)} />
          </div>
          <div>
            <label htmlFor="location">{t('generation.location')}</label>
            <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label htmlFor="mood">{t('generation.mood')}</label>
            <input id="mood" value={mood} onChange={(e) => setMood(e.target.value)} />
          </div>
          <div>
            <label htmlFor="lighting">{t('generation.lighting')}</label>
            <input id="lighting" value={lighting} onChange={(e) => setLighting(e.target.value)} />
          </div>
          <div>
            <label htmlFor="aspectRatio">{t('generation.aspectRatio')}</label>
            <select
              id="aspectRatio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
            >
              {['3:4', '9:16', '1:1', '16:9'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label>{t('generation.platforms')}</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn ${platforms.includes(p) ? '' : 'secondary'}`}
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => togglePlatform(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={enrich}
            onChange={(e) => setEnrich(e.target.checked)}
          />
          <span>{t('generation.enrichCaptions')}</span>
        </label>
        </fieldset>
        {intent.current && !busy && <p>{t('generation.unresolvedRequest')}</p>}
        {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
        {busy && <p role="status">{t('generation.submitting')}</p>}
        <div>
          <button className="btn" type="submit" disabled={busy || (!intent.current && platforms.length === 0)}>
            {busy ? t('generation.generating') : intent.current ? t('generation.checkSameRequest') : mediaKind === 'brief' ? t('generation.generateBrief') : t('generation.queueGrok')}
          </button>
        </div>
      </form>

      {result && (
        <div style={{ marginTop: 20 }}>
          <GeneratedCaptionReceipt captions={result.bundle?.captions} enrichment={result.captionEnrichment} />
          {result.mediaGeneration === 'queued' && result.bundle?.id && (
            <GenerationProgress key={result.bundle.id} bundleId={result.bundle.id} modelId={modelId} operatorControls={operatorControls} />
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{result.mediaGeneration === 'queued' ? t('generation.initialTosReport') : t('generation.tosReport')}</h3>
            <span
              className={`badge ${result.tosReport.verdict === 'pass' ? 'good' : result.tosReport.verdict === 'review' ? 'warn' : 'bad'}`}
            >
              {result.tosReport.verdict}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('generation.platform')}</th>
                <th>{t('generation.score')}</th>
                <th>{t('generation.verdict')}</th>
              </tr>
            </thead>
            <tbody>
              {result.tosReport.scores.map((s) => (
                <tr key={s.platform}>
                  <td>{s.platform}</td>
                  <td>{formatNumber(s.score, locale, { maximumFractionDigits: 2 })}</td>
                  <td>
                    <span
                      className={`badge ${s.verdict === 'pass' ? 'good' : s.verdict === 'review' ? 'warn' : 'bad'}`}
                    >
                      {s.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.variants.map((v, i) => (
            <div key={i} className="card" style={{ background: 'var(--panel2)' }}>
              <h3>{v.styleLabel}</h3>
              <p className="mono" style={{ color: 'var(--muted)' }}>
                {v.prompt}
              </p>
              <p>{v.caption}</p>
              <p className="mono" style={{ color: 'var(--muted)' }}>
                {v.hashtags.join(' ')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
