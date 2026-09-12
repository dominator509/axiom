'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelGrok, connectGrok, resumeGrok, type GrokAttempt } from '@/lib/grok-connection';

export default function GrokConnection() {
  const [status, setStatus] = useState('Connection not checked');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<GrokAttempt | null>(null);
  const active = useRef<AbortController | null>(null);
  const run = useCallback(async (login: boolean) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setInstructions('');
    setStatus(login ? 'Follow the Grok login instructions below' : 'Checking connection…');
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
            ? 'Grok login completed. Generation access has not yet been verified.'
            : 'Grok credential file found. Provider access has not yet been verified.'
          : 'No saved Grok credential file found');
        if (connected) setInstructions('');
      }
    } catch {
      if (active.current === controller) setStatus('Connection not confirmed. Check status before trying again.');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }, []);
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
        setStatus('Cancellation requested. Check status before trying again.');
      }
    } catch {
      if (active.current === controller) setStatus('Cancellation not confirmed. Check status before trying again.');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <section aria-label="Grok account connection" className="stack">
    <p role="status">{status}</p>
    <p>Connect your own Grok account before generating media. Sign in only on Grok’s authorization page; never paste passwords or tokens here. Connecting does not generate media.</p>
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => void run(false)}>Check Grok connection</button>
      <button type="button" disabled={busy} onClick={() => void run(true)}>Connect Grok account</button>
      {attempt && ['pending', 'cancelling'].includes(attempt.state) && <button type="button" onClick={() => void cancel()}>Cancel Grok login</button>}
    </div>
    {instructions && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{instructions}</pre>}
  </section>;
}
