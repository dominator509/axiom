'use client';

import { useEffect, useState } from 'react';

type MediaIdentity = { bundleId: string; modelId?: never; assetId?: never }
  | { bundleId?: never; modelId: string; assetId: string };

export default function BundleMedia(identity: MediaIdentity) {
  const [kind, setKind] = useState<'image' | 'video' | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = identity.bundleId !== undefined
    ? `/api/v1/bundles/${encodeURIComponent(identity.bundleId)}/media`
    : `/api/v1/models/${encodeURIComponent(identity.modelId)}/media/${encodeURIComponent(identity.assetId)}`;
  useEffect(() => {
    setKind(null);
    setFailed(false);
    const controller = new AbortController();
    let cancelled = false;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch(src, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Preview unavailable');
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!['image/jpeg', 'image/png', 'video/mp4', 'video/webm'].includes(type ?? '')) throw new Error('Preview unavailable');
        if (!cancelled && !controller.signal.aborted) setKind(type?.startsWith('video/') ? 'video' : 'image');
      } catch {
        if (!cancelled) setFailed(true);
      } finally { clearTimeout(deadline); }
    })();
    return () => { cancelled = true; clearTimeout(deadline); controller.abort(); };
  }, [src, attempt]);
  if (failed) return <div>
    <p role="status">Media preview unavailable. Do not approve without inspecting the generated media.</p>
    <button type="button" className="btn secondary" onClick={() => {
      setFailed(false);
      setKind(null);
      setAttempt(previous => previous + 1);
    }}>Retry media preview</button>
    <p>Reloads the saved media only. It does not generate or publish anything.</p>
  </div>;
  if (!kind) return <p role="status">Loading media preview…</p>;
  return kind === 'video'
    ? <video controls playsInline preload="metadata" src={src} style={{ display: 'block', alignSelf: 'center', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} onError={() => setFailed(true)} />
    // Authenticated same-origin bytes must not go through the public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={src} alt={identity.bundleId !== undefined ? 'Generated media for this bundle' : 'Saved talent media'} style={{ display: 'block', alignSelf: 'center', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} onError={() => setFailed(true)} />;
}
