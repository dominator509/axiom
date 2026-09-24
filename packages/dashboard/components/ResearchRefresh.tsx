'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from './LocaleProvider';

export default function ResearchRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!active || pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, 10_000);
    return () => clearInterval(timer);
  }, [active, pending, router]);
  return <div className="stack">
    {active && <p role="status">{t('scrape.refreshActive')}</p>}
    <button className="btn secondary" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? t('scrape.refreshing') : t('scrape.refresh')}
    </button>
  </div>;
}
