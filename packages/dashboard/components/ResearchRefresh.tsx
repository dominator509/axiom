'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function ResearchRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!active || pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, 10_000);
    return () => clearInterval(timer);
  }, [active, pending, router]);
  return <div className="stack">
    {active && <p role="status">Research is queued or running. This page checks for updates every 10 seconds while visible.</p>}
    <button className="btn secondary" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? 'Refreshing research…' : 'Refresh research results'}
    </button>
  </div>;
}
