'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi as api } from '@/lib/client-api';
import { useLocale } from './LocaleProvider';

export default function DiscordBotConnect({ modelId }: { modelId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await api.social.connectDiscordBot({ modelId, botToken, channelId });
      setBotToken('');
      setMessage(t('network.discordConnected'));
      router.refresh();
    } catch {
      setFailed(true);
      setMessage(t('network.discordConnectFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <label className="stack">
        <span>{t('network.discordBotToken')}</span>
        <input type="password" autoComplete="new-password" required minLength={40} maxLength={256} value={botToken} onChange={(event) => setBotToken(event.target.value)} />
      </label>
      <label className="stack">
        <span>{t('network.discordChannelId')}</span>
        <input type="text" inputMode="numeric" autoComplete="off" required minLength={16} maxLength={22} pattern="[0-9]{16,22}" value={channelId} onChange={(event) => setChannelId(event.target.value)} />
      </label>
      <div className="action-row">
        <button className="btn secondary" type="submit" disabled={busy || !botToken || !channelId}>
          {busy ? t('network.discordConnecting') : t('network.discordBotTitle')}
        </button>
        {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
      </div>
    </form>
  );
}
