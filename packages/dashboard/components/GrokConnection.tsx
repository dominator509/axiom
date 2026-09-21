'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelGrok, connectGrok, disconnectGrok, resumeGrok, type GrokAttempt } from '@/lib/grok-connection';
import { useLocale } from './LocaleProvider';

export default function GrokConnection() {
  const { t } = useLocale();
  const [status, setStatus] = useState(() => t('dashboard.grok.statusNotChecked'));
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<GrokAttempt | null>(null);
  const [connected, setConnected] = useState(false);
  const active = useRef<AbortController | null>(null);
  const run = useCallback(async (login: boolean) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setInstructions('');
    setStatus(login ? t('connection.loginOutput') : t('connection.statusChecking'));
    const timeout = setTimeout(() => controller.abort(), 360000);
    try {
      const message = (text: string) => {
        if (active.current === controller && !controller.signal.aborted)
          setInstructions(text);
      };
      const observed = (value: GrokAttempt) => {
        if (active.current === controller && !controller.signal.aborted) setAttempt(value);
      };
      if (login) await connectGrok(controller.signal, message, observed);
      const connected = login || await resumeGrok(controller.signal, message, observed);
      if (active.current === controller && !controller.signal.aborted) {
        setStatus(connected
          ? login
            ? t('dashboard.grok.loginCompleted')
            : t('dashboard.grok.credentialFound')
            : t('dashboard.grok.noCredential'));
        setConnected(connected);
        if (connected) setInstructions('');
      }
    } catch {
      if (active.current === controller) setStatus(t('dashboard.grok.checkUnconfirmed'));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }, [t]);
  useEffect(() => {
    void run(false);
    const resume = () => { if (!active.current) void run(false); };
    window.addEventListener('focus', resume);
    return () => { window.removeEventListener('focus', resume); active.current?.abort(); active.current = null; };
  }, [run]);
  async function cancel() {
    if (!attempt) return;
    active.current?.abort(); active.current = null;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setInstructions('');
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await cancelGrok(attempt.id, controller.signal);
      if (active.current === controller) {
        setAttempt(result);
        setStatus(t('dashboard.grok.cancelRequested'));
      }
    } catch {
      if (active.current === controller) setStatus(t('dashboard.grok.checkUnconfirmed'));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  async function disconnect() {
    if (busy || !connected) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setInstructions(''); setStatus(t('connection.disconnecting'));
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      await disconnectGrok(controller.signal);
      if (active.current === controller) { setConnected(false); setStatus(t('connection.disconnected')); }
    } catch {
      if (active.current === controller) setStatus(t('connection.changeUnconfirmed'));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <section aria-label={t('connection.grokTitle')} className="stack">
    <p role="status">{status}</p>
    <p>{t('connection.grokDescription')}</p>
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => void run(false)}>{t('dashboard.grok.checkSaved')}</button>
      <button type="button" disabled={busy} onClick={() => void run(true)}>{t('dashboard.grok.connectAccount')}</button>
      {attempt && ['pending', 'cancelling'].includes(attempt.state) && <button type="button" onClick={() => void cancel()}>{t('dashboard.grok.cancelLogin')}</button>}
      {connected && !attempt?.state?.match(/^(pending|cancelling)$/) && <button type="button" disabled={busy} onClick={() => void disconnect()}>{t('action.disconnect')}</button>}
    </div>
    <p>{t('dashboard.grok.generationNote')}</p>
    {instructions && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{instructions}</pre>}
  </section>;
}
