'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi as api } from '@/lib/client-api';
import { useLocale } from './LocaleProvider';

type RefreshablePlatform = 'fanvue' | 'tiktok' | 'x' | 'youtube' | 'reddit' | 'snapchat';

export default function RefreshSocialAccountButton({
  platform,
  connectionId,
}: {
  platform: RefreshablePlatform;
  connectionId: string;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await api.social.refreshOAuth(platform, connectionId);
      setMessage(t('network.connectionRefreshSuccess'));
      router.refresh();
    } catch {
      setFailed(true);
      setMessage(t('network.connectionRefreshFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="stack">
      <button className="btn secondary" type="button" disabled={busy} onClick={() => void refresh()}>
        {busy ? t('network.refreshingConnection') : t('network.refreshConnection')}
      </button>
      {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
    </span>
  );
}
