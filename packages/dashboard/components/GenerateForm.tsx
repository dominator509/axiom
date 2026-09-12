'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import GenerationProgress from './GenerationProgress';
import GrokConnection from './GrokConnection';
import MediaUpload from './MediaUpload';

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

export default function GenerateForm({ modelId }: { modelId: string }) {
  const router = useRouter();
  const [style, setStyle] = useState('studio');
  const [outfit, setOutfit] = useState('summer dress');
  const [location, setLocation] = useState('studio');
  const [mood, setMood] = useState('energetic');
  const [lighting, setLighting] = useState('soft studio');
  const [aspectRatio, setAspectRatio] = useState('4:5');
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [enrich, setEnrich] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bundle?: { id: string };
    mediaGeneration?: 'queued';
    variants: Array<{ prompt: string; styleLabel: string; caption: string; hashtags: string[] }>;
    tosReport: {
      verdict: string;
      scores: Array<{ platform: string; verdict: string; score: number }>;
    };
  } | null>(null);
  const [mediaKind, setMediaKind] = useState<'brief' | 'image' | 'video'>('brief');
  const [mediaPrompt, setMediaPrompt] = useState('');
  const [sourceAssetId, setSourceAssetId] = useState('');
  const [duration, setDuration] = useState<6 | 10>(6);
  const [sourceImages, setSourceImages] = useState<Array<{ id: string; fileName: string }>>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sanitizeMetadata, setSanitizeMetadata] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<{ modelId: string; body: string; key: string } | null>(null);

  useEffect(() => {
    setSourceAssetId('');
    setSourceImages([]);
    setSourceError(null);
    if (mediaKind !== 'video') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/models/${modelId}/media-source-images`, { signal: controller.signal });
        if (!response.ok) throw new Error('Source images unavailable');
        const body = await readDashboardJson<{ data: Array<{ id: string; fileName: string }> }>(response);
        if (!controller.signal.aborted) setSourceImages(body.data);
      } catch {
        if (!controller.signal.aborted) setSourceError('Could not load source images. Switch away from video and back to retry.');
      }
    })();
    return () => controller.abort();
  }, [modelId, mediaKind]);

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || platforms.length === 0
      || (mediaKind !== 'brief' && !mediaPrompt.trim())
      || (mediaKind === 'video' && !sourceAssetId)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const requestBody = JSON.stringify({
        style, outfit, location, mood, lighting, aspectRatio, platforms, enrichWithLlm: enrich,
        ...(mediaKind === 'brief' ? {} : { media: {
          kind: mediaKind, prompt: mediaPrompt.trim(),
          ...(sanitizeMetadata ? { sanitizeMetadata: true } : {}),
          ...(mediaKind === 'image' ? { aspectRatio } : {}),
          ...(mediaKind === 'video' ? { sourceAssetId, duration } : {}),
        } }),
      });
      if (intent.current?.modelId !== modelId || intent.current.body !== requestBody) {
        intent.current = { modelId, body: requestBody, key: createIdempotencyKey() };
      }
      const res = await mutationFetch(`/api/v1/models/${modelId}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
      }, { idempotencyKey: intent.current.key });
      if (!res.ok) {
        const b = await readDashboardError(res);
        setError(b?.error?.message ?? 'Generation failed');
        return;
      }
      const body = await readDashboardJson<{ data: typeof result }>(res);
      setResult(body.data);
      intent.current = null;
      router.refresh();
    } catch {
      setError('Generation could not be confirmed. Retry the unchanged brief to check the same request.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Create content brief</h2>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Create a text brief or queue Grok image/video generation using your connected subscription.
        Media remains pending until generation and visual ToS checks finish. Provider usage may be charged.
      </p>
      <GrokConnection />
      <MediaUpload modelId={modelId} onUploaded={asset => {
        if (asset.mimeType.startsWith('image/')) {
          setSourceImages(previous => [{ id: asset.id, fileName: `Uploaded image ${asset.id}` }, ...previous]);
          setSourceAssetId(asset.id);
        }
        router.refresh();
      }} />
      <form onSubmit={onSubmit} className="stack" style={{ maxWidth: 640 }}>
        <fieldset disabled={busy} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label htmlFor="mediaKind">Output</label>
        <select id="mediaKind" value={mediaKind} onChange={e => setMediaKind(e.target.value as 'brief' | 'image' | 'video')}>
          <option value="brief">Text brief only</option>
          <option value="image">Grok image</option>
          <option value="video">Grok image-to-video</option>
        </select>
        {mediaKind !== 'brief' && <>
          <label htmlFor="mediaPrompt">Media prompt</label>
          <textarea id="mediaPrompt" required maxLength={4000} value={mediaPrompt} onChange={e => setMediaPrompt(e.target.value)} />
          <label><input type="checkbox" checked={sanitizeMetadata} onChange={e => setSanitizeMetadata(e.target.checked)} /> Remove metadata and embedded provenance, including C2PA (optional)</label>
          <p>Rebuilds generated media and video source images before use. Images become PNG; video is re-encoded. Existing watermarks remain. A cleaning failure holds the result; no automatic generation retry.</p>
        </>}
        {mediaKind === 'video' && <>
          <label htmlFor="sourceAsset">Source image (latest 100 for this model)</label>
          <select id="sourceAsset" required value={sourceAssetId} onChange={e => setSourceAssetId(e.target.value)}>
            <option value="">Select a stored image</option>
            {sourceImages.map(image => <option key={image.id} value={image.id}>{image.fileName}</option>)}
          </select>
          {sourceError && <p role="alert">{sourceError}</p>}
          {!sourceError && sourceImages.length === 0 && <p>Generate or import a source image for this model first.</p>}
          <label htmlFor="videoDuration">Video duration</label>
          <select id="videoDuration" value={duration} onChange={e => setDuration(Number(e.target.value) as 6 | 10)}>
            <option value={6}>6 seconds</option><option value={10}>10 seconds</option>
          </select>
        </>}
        <div className="grid">
          <div>
            <label htmlFor="style">Style</label>
            <input id="style" value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="outfit">Outfit</label>
            <input id="outfit" value={outfit} onChange={(e) => setOutfit(e.target.value)} />
          </div>
          <div>
            <label htmlFor="location">Location</label>
            <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label htmlFor="mood">Mood</label>
            <input id="mood" value={mood} onChange={(e) => setMood(e.target.value)} />
          </div>
          <div>
            <label htmlFor="lighting">Lighting</label>
            <input id="lighting" value={lighting} onChange={(e) => setLighting(e.target.value)} />
          </div>
          <div>
            <label htmlFor="aspectRatio">Aspect ratio</label>
            <select
              id="aspectRatio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
            >
              {['4:5', '9:16', '1:1', '16:9'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label>Platforms</label>
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
        <label className="row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enrich}
            onChange={(e) => setEnrich(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Enrich captions via LLM gateway (optional, live provider call)
        </label>
        {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
        <div>
          <button className="btn" type="submit" disabled={busy || platforms.length === 0}>
            {busy ? 'Generating…' : mediaKind === 'brief' ? 'Generate content brief' : 'Queue Grok generation'}
          </button>
        </div>
        </fieldset>
      </form>

      {result && (
        <div style={{ marginTop: 20 }}>
          {result.mediaGeneration === 'queued' && result.bundle?.id && (
            <GenerationProgress key={result.bundle.id} bundleId={result.bundle.id} modelId={modelId} />
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{result.mediaGeneration === 'queued' ? 'Initial ToS report (before media generation)' : 'ToS report'}</h3>
            <span
              className={`badge ${result.tosReport.verdict === 'pass' ? 'good' : result.tosReport.verdict === 'review' ? 'warn' : 'bad'}`}
            >
              {result.tosReport.verdict}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Score</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {result.tosReport.scores.map((s) => (
                <tr key={s.platform}>
                  <td>{s.platform}</td>
                  <td>{s.score}</td>
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
