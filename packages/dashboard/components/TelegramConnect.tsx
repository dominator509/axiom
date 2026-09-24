'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi as api } from '@/lib/client-api';
import { useLocale } from './LocaleProvider';

export default function TelegramConnect({ modelId }: { modelId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await api.social.connectTelegram({ modelId, botToken, channelId });
      setBotToken('');
      setMessage(t('network.telegramConnected'));
      router.refresh();
    } catch {
      setFailed(true);
      setMessage(t('network.telegramConnectFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="stack">
        <span>{t('network.telegramBotToken')}</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={30}
          maxLength={256}
          value={botToken}
          onChange={(event) => setBotToken(event.target.value)}
        />
      </label>
      <label className="stack">
        <span>{t('network.telegramChannelId')}</span>
        <input
          type="text"
          autoComplete="off"
          required
          maxLength={64}
          placeholder="@channel or -100…"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
        />
      </label>
      <div className="action-row">
        <button className="btn secondary" type="submit" disabled={busy || !botToken || !channelId}>
          {busy ? t('network.telegramConnecting') : t('network.connectTelegram')}
        </button>
        {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
      </div>
    </form>
  );
}
