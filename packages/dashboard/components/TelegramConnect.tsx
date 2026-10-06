'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { clientApi as api } from '@/lib/client-api';
import { useLocale } from './LocaleProvider';

export function telegramConnectErrorKey(code?: string) {
  switch (code) {
    case 'TELEGRAM_BOT_TOKEN_INVALID':
      return 'network.telegramBotTokenInvalid';
    case 'TELEGRAM_EGRESS_UNAVAILABLE':
      return 'network.telegramEgressUnavailable';
    case 'TELEGRAM_PROVIDER_UNAVAILABLE':
      return 'network.telegramProviderUnavailable';
    case 'TELEGRAM_TARGET_IS_BOT':
      return 'network.telegramTargetIsBot';
    case 'TELEGRAM_TARGET_INVALID':
    case 'TELEGRAM_TARGET_NOT_CHANNEL':
      return 'network.telegramDestinationInvalid';
    case 'TELEGRAM_BOT_CANNOT_POST':
      return 'network.telegramPostingPermission';
    default:
      return 'network.telegramConnectFailed';
  }
}

export default function TelegramConnect({ modelId }: { modelId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const channelHintId = useId();
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
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
      setFailed(true);
      setMessage(t(telegramConnectErrorKey(code)));
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
          aria-describedby={channelHintId}
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
        />
      </label>
      <p id={channelHintId} className="subtle">{t('network.telegramTargetHint')}</p>
      <div className="action-row">
        <button className="btn secondary" type="submit" disabled={busy || !botToken || !channelId}>
          {busy ? t('network.telegramConnecting') : t('network.connectTelegram')}
        </button>
        {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
      </div>
    </form>
  );
}
