'use client';

import { useEffect, useState } from 'react';

export default function BundleMedia({ bundleId }: { bundleId: string }) {
  const [kind, setKind] = useState<'image' | 'video' | null>(null);
  const [failed, setFailed] = useState(false);
  const src = `/api/v1/bundles/${encodeURIComponent(bundleId)}/media`;
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
        if (!['image/jpeg', 'image/png', 'video/mp4'].includes(type ?? '')) throw new Error('Preview unavailable');
        if (!controller.signal.aborted) setKind(type === 'video/mp4' ? 'video' : 'image');
      } catch {
        if (!cancelled) setFailed(true);
      } finally { clearTimeout(deadline); }
    })();
    return () => { cancelled = true; clearTimeout(deadline); controller.abort(); };
  }, [src]);
  if (failed) return <p role="status">Media preview unavailable. Do not approve without inspecting the generated media.</p>;
  if (!kind) return <p role="status">Loading media preview…</p>;
  return kind === 'video'
    ? <video controls preload="metadata" src={src} style={{ maxWidth: '100%', maxHeight: 480 }} onError={() => setFailed(true)} />
    // Authenticated same-origin bytes must not go through the public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={src} alt="Generated media for this bundle" style={{ maxWidth: '100%', maxHeight: 480 }} onError={() => setFailed(true)} />;
}
