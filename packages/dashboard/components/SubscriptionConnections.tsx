'use client';

import { useEffect, useRef, useState } from 'react';
import { connectSubscription, disconnectSubscription, readSubscriptionStatus, type SelfServiceSubscriptionProvider } from '@/lib/subscription-connections';
import { useLocale } from './LocaleProvider';

type Row = {
  state: 'checking' | 'connected' | 'not-connected' | 'unavailable';
  busy: boolean;
  output: string;
  message: string;
};

const PROVIDERS: SelfServiceSubscriptionProvider[] = ['openai', 'anthropic'];
const initialRows = (): Record<SelfServiceSubscriptionProvider, Row> => Object.fromEntries(
  PROVIDERS.map(provider => [provider, { state: 'checking', busy: false, output: '', message: '' }]),
) as Record<SelfServiceSubscriptionProvider, Row>;

export default function SubscriptionConnections() {
  const { t } = useLocale();
  const [rows, setRows] = useState(initialRows);
  const active = useRef<Partial<Record<SelfServiceSubscriptionProvider, AbortController>>>({});
  const label = (provider: SelfServiceSubscriptionProvider) =>
    provider === 'openai' ? t('connection.providerOpenAI') : t('connection.providerAnthropic');

  function update(provider: SelfServiceSubscriptionProvider, change: Partial<Row>) {
    setRows(current => ({ ...current, [provider]: { ...current[provider], ...change } }));
  }

  async function refresh(provider: SelfServiceSubscriptionProvider, controller: AbortController) {
    update(provider, { state: 'checking', busy: true, message: '' });
    try {
      const result = await readSubscriptionStatus(provider, controller.signal);
      update(provider, { state: result.connected ? 'connected' : 'not-connected', busy: false });
    } catch {
      if (!controller.signal.aborted) update(provider, { state: 'unavailable', busy: false, message: t('connection.statusUnavailable') });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    for (const provider of PROVIDERS) void refresh(provider, controller);
    return () => controller.abort();
  }, []);

  async function start(provider: SelfServiceSubscriptionProvider) {
    if (active.current[provider]) return;
    const controller = new AbortController();
    active.current[provider] = controller;
    update(provider, { busy: true, message: '', output: '', state: 'checking' });
    try {
      await connectSubscription(provider, controller.signal, message => {
        const bounded = message.slice(0, 2048);
        setRows(current => ({
          ...current,
          [provider]: { ...current[provider], output: `${current[provider].output}\n${bounded}`.trim().slice(-16384) },
        }));
      });
      const status = await readSubscriptionStatus(provider, controller.signal);
      if (!status.connected) throw new Error('Provider connection could not be confirmed');
      update(provider, { state: 'connected', busy: false, message: '' });
    } catch {
      if (!controller.signal.aborted) update(provider, { state: 'unavailable', busy: false, message: t('connection.changeUnconfirmed') });
    } finally {
      if (active.current[provider] === controller) delete active.current[provider];
    }
  }

  async function disconnect(provider: SelfServiceSubscriptionProvider) {
    if (active.current[provider] || !window.confirm(t('connection.disconnectConfirm'))) return;
    const controller = new AbortController();
    active.current[provider] = controller;
    update(provider, { busy: true, message: t('connection.disconnecting'), output: '' });
    try {
      const result = await disconnectSubscription(provider, controller.signal);
      if (result.connected) throw new Error('Disconnect was not confirmed');
      update(provider, { state: 'not-connected', busy: false, message: t('connection.disconnected') });
    } catch {
      if (!controller.signal.aborted) update(provider, { state: 'unavailable', busy: false, message: t('connection.changeUnconfirmed') });
    } finally {
      if (active.current[provider] === controller) delete active.current[provider];
    }
  }

  return <section className="card stack" aria-labelledby="subscription-connections-title">
    <h2 id="subscription-connections-title">{t('connection.title')}</h2>
    <p className="subtle">{t('connection.description')}</p>
    {PROVIDERS.map(provider => {
      const row = rows[provider];
      const status = row.state === 'connected'
        ? t('connection.statusConnected')
        : row.state === 'not-connected'
          ? t('connection.statusNotConnected')
          : row.state === 'checking'
            ? t('connection.statusChecking')
            : t('connection.statusUnavailable');
      return <article className="card stack" key={provider} aria-label={label(provider)}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{label(provider)}</h3>
          <span className="subtle" role="status">{status}</span>
        </div>
        <div className="actions">
          <button type="button" className="btn secondary" disabled={row.busy} onClick={() => {
            const controller = new AbortController();
            void refresh(provider, controller);
          }}>{t('action.retry')}</button>
          {row.state === 'connected'
            ? <button type="button" className="btn secondary" disabled={row.busy} onClick={() => void disconnect(provider)}>{t('action.disconnect')}</button>
            : <button type="button" className="btn" disabled={row.busy} onClick={() => void start(provider)}>{t('action.connect')}</button>}
        </div>
        {row.output && <div><h4>{t('connection.loginOutput')}</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.output}</pre></div>}
        {row.message && <p role="status">{row.message}</p>}
      </article>;
    })}
  </section>;
}
