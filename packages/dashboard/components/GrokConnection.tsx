'use client';
import { useEffect, useRef, useState } from 'react';
import { connectGrok, grokConnectionStatus } from '@/lib/grok-connection';

export default function GrokConnection() {
  const [status, setStatus] = useState('Connection not checked');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  async function run(login: boolean) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setInstructions('');
    setStatus(login ? 'Follow the Grok login instructions below' : 'Checking connection…');
    const timeout = setTimeout(() => controller.abort(), login ? 300000 : 15000);
    try {
      if (login) await connectGrok(controller.signal, message => {
        if (active.current === controller && !controller.signal.aborted)
          setInstructions(previous => `${previous}\n${message}`.slice(-16384));
      });
      const connected = login || await grokConnectionStatus(controller.signal);
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
  }
  function cancel() {
    active.current?.abort(); active.current = null;
    setBusy(false); setInstructions('');
    setStatus('Login observation cancelled. Check status before trying again.');
  }
  return <section aria-label="Grok account connection" className="stack">
    <p role="status">{status}</p>
    <p>Connect your own Grok account before generating media. Sign in only on Grok’s authorization page; never paste passwords or tokens here. Connecting does not generate media.</p>
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => void run(false)}>Check Grok connection</button>
      <button type="button" disabled={busy} onClick={() => void run(true)}>Connect Grok account</button>
      {busy && <button type="button" onClick={cancel}>Cancel connection check</button>}
    </div>
    {instructions && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{instructions}</pre>}
  </section>;
}
