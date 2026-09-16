'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import GenerationRetry from './GenerationRetry';

/** Persistent entry point from the review queue; the API decides eligibility. */
export default function SavedGenerationRetry({ modelId, bundleId, blocked }: {
  modelId: string; bundleId: string; blocked: boolean;
}) {
  const router = useRouter();
  const [queued, setQueued] = useState(false);
  if (queued) return <p role="status">Replacement queued. Refresh Approvals to follow its new media and ToS scan.</p>;
  return <details>
    <summary>Media generation retry options</summary>
    <p>Available for generated image and video bundles. The server checks the saved provider and attempt; active or uncertain provider outcomes cannot be retried here.</p>
    <GenerationRetry modelId={modelId} bundleId={bundleId} blocked={blocked} onQueued={() => {
      setQueued(true);
      router.refresh();
    }} />
  </details>;
}
