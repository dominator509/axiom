'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RoleplayActor, RoleplayHandoff, RoleplayMemoryTurn, RoleplayPersona, RoleplayTurnResult } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

export interface RoleplayActorOption {
  actor: RoleplayActor;
  label: string;
  shiftId: string;
  queue: string;
}

interface RoleplayContext {
  handoff: RoleplayHandoff | null;
  handoffRevision: number;
  persona: RoleplayPersona | null;
  memory: RoleplayMemoryTurn[];
  meta: { nextSequence: number; activeShiftId: string; queue: string; actor: RoleplayActor };
}

export default function RoleplayManager({ modelId, actorOptions, canEdit }: { modelId: string; actorOptions: RoleplayActorOption[]; canEdit: boolean }) {
  const [actor, setActor] = useState<RoleplayActorOption | null>(actorOptions[0] ?? null);
  const [conversationKey, setConversationKey] = useState('default');
  const [context, setContext] = useState<RoleplayContext | null>(null);
  const [personaText, setPersonaText] = useState('');
  const [summary, setSummary] = useState('');
  const [nextAction, setNextAction] = useState('Review the next bounded roleplay turn');
  const [memoryRole, setMemoryRole] = useState<'user' | 'assistant'>('user');
  const [memoryText, setMemoryText] = useState('');
  const [turnPrompt, setTurnPrompt] = useState('');
  const [lastTurn, setLastTurn] = useState<RoleplayTurnResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const actorKey = actor ? `${actor.actor.type}:${actor.actor.ref}` : '';
  const activeHandoff = context?.handoff;
  const selectedShiftId = context?.meta.activeShiftId ?? actor?.shiftId ?? '';

  async function load() {
    if (!actor) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const query = new URLSearchParams({ conversationKey, actorType: actor.actor.type, actorRef: actor.actor.ref });
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/roleplay?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { const details = await readDashboardError(response); throw new Error(details?.error?.message ?? 'Roleplay context is unavailable.'); }
      const body = await readDashboardJson<{ data: RoleplayContext }>(response);
      if (!body.data?.meta?.activeShiftId || body.data.meta.actor?.ref !== actor.actor.ref) throw new Error('Roleplay context was not confirmed.');
      setContext(body.data);
      setPersonaText(body.data.persona?.content ?? '');
      setSummary(body.data.handoff?.lastSafeSummary ?? '');
      setNextAction(body.data.handoff?.allowedNextAction ?? 'Review the next bounded roleplay turn');
    } catch (loadError) { setContext(null); setError(loadError instanceof Error ? loadError.message : 'Roleplay context is unavailable.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { setLastTurn(null); void load(); }, [actorKey, conversationKey]);

  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); throw new Error(details?.error?.message ?? 'Roleplay change was not accepted.'); }
      await readDashboardJson<{ data: unknown }>(response);
      setMessage(success);
      await load();
    } catch (mutationError) { setError(mutationError instanceof Error ? mutationError.message : 'Roleplay change was not confirmed.'); }
    finally { setBusy(false); }
  }

  async function loadPersonaFile(file: File) {
    setError('');
    setMessage('');
    if (file.size > 32 * 1024) {
      setError('Persona file is too large; keep the source under 8,000 characters.');
      return;
    }
    try {
      const text = await file.text();
      if (text.length > 8_000) {
        setError('Persona file is too large; keep the source under 8,000 characters.');
        return;
      }
      setPersonaText(text);
      setMessage(`Loaded ${file.name}. Review it before saving a new revision.`);
    } catch {
      setError('The persona file could not be read in this browser.');
    }
  }

  function savePersona() {
    if (!canEdit || !context) return;
    void mutate(`/api/v1/models/${encodeURIComponent(modelId)}/roleplay/persona`, { expectedRevision: context.persona?.revision ?? 0, sourceRef: 'soul.md', content: personaText }, 'Persona revision saved.');
  }

  function saveHandoff() {
    if (!context || !actor || !selectedShiftId) return;
    const handoff: RoleplayHandoff = activeHandoff ? {
      ...activeHandoff,
      actor: actor.actor,
      shiftId: selectedShiftId,
      queue: context.meta.queue,
      lastSafeSummary: summary,
      allowedNextAction: nextAction,
    } : {
      currentOwner: actor.actor,
      actor: actor.actor,
      orgId: '',
      modelId,
      shiftId: selectedShiftId,
      queue: context.meta.queue,
      conversationCursor: null,
      lastSafeSummary: summary,
      pendingIntentId: null,
      memoryPolicy: { maxTurns: 20, maxCharacters: 8_000 },
      personaSource: null,
      allowedNextAction: nextAction,
      terminal: false,
      unresolvedUncertainty: null,
      evidenceReferences: [],
    };
    void mutate(`/api/v1/models/${encodeURIComponent(modelId)}/roleplay/handoff`, { conversationKey, expectedRevision: context.handoffRevision, handoff }, 'Handoff saved for the next human or LLM owner.');
  }

  async function appendMemory() {
    if (!context || !actor || !memoryText.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/roleplay/memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationKey, sequence: context.meta.nextSequence, role: memoryRole, speaker: actor.actor, content: memoryText.trim() }) }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); throw new Error(details?.error?.message ?? 'Memory turn was not accepted.'); }
      await readDashboardJson<{ data: unknown }>(response);
      setMemoryText(''); setMessage('Bounded memory turn saved.'); await load();
    } catch (appendError) { setError(appendError instanceof Error ? appendError.message : 'Memory turn was not confirmed.'); }
    finally { setBusy(false); }
  }

  async function generateTurn() {
    if (!canEdit || !context || !actor || actor.actor.type !== 'llm' || !turnPrompt.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/roleplay/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationKey,
          intentKey: globalThis.crypto.randomUUID(),
          actor: actor.actor,
          content: turnPrompt.trim(),
          confirm: true,
        }),
      }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) { const details = await readDashboardError(response); throw new Error(details?.error?.message ?? 'Grok roleplay turn was not accepted.'); }
      const body = await readDashboardJson<{ data: RoleplayTurnResult }>(response);
      setLastTurn(body.data);
      setTurnPrompt('');
      await load();
      setMessage('Grok reply recorded in bounded memory; nothing was published.');
    } catch (turnError) { setError(turnError instanceof Error ? turnError.message : 'Grok roleplay turn was not confirmed.'); }
    finally { setBusy(false); }
  }

  const actorLabel = useMemo(() => actor ? actor.label : 'No active actor', [actor]);
  return <div className="page-stack">
    <div className="card stack">
      <h2>Chatter &amp; roleplay</h2>
      <p className="subtle">One bounded handoff works for a human chatter or an approved LLM actor. Memory is tenant/model scoped and trimmed to the saved policy. Persona text is guidance data only; it cannot bypass safety, consent, approval, ToS or publication controls.</p>
      <div className="row">
        <label>Conversation key<input value={conversationKey} onChange={event => setConversationKey(event.target.value)} maxLength={128} /></label>
        <label>Active actor<select value={actorKey} onChange={event => setActor(actorOptions.find(option => `${option.actor.type}:${option.actor.ref}` === event.target.value) ?? null)}>{actorOptions.length === 0 && <option value="">No active actor</option>}{actorOptions.map(option => <option key={`${option.actor.type}:${option.actor.ref}`} value={`${option.actor.type}:${option.actor.ref}`}>{option.label}</option>)}</select></label>
      </div>
      <p className="subtle">Selected: {actorLabel} · queue {context?.meta.queue ?? actor?.queue ?? '—'} · human owners can hand off or append memory; assigned LLM owners can use the explicit Grok turn action below.</p>
      {error && <p className="notice error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button className="btn secondary" type="button" disabled={busy || !actor} onClick={() => void load()}>Reload bounded context</button>
    </div>
    <div className="grid">
      <section className="card stack">
        <h3>Persona · soul.md</h3>
        <p className="subtle">The stored source is versioned and size-limited. The gateway loads it through an approved tenant/model reader; arbitrary filesystem paths are never accepted.</p>
        <label>Load a local soul.md or persona prompt<input type="file" accept=".md,.txt,text/markdown,text/plain" disabled={!canEdit || busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void loadPersonaFile(file); }} /></label>
        <textarea value={personaText} onChange={event => setPersonaText(event.target.value)} maxLength={8000} rows={12} placeholder="Write bounded character guidance…" disabled={!canEdit || busy} />
        <p className="subtle">Revision: {context?.persona?.revision ?? 0} · {personaText.length}/8000 characters</p>
        {canEdit ? <button className="btn" type="button" disabled={busy || !context || !personaText.trim()} onClick={savePersona}>Save new persona revision</button> : <p className="subtle">Persona editing requires an owner, manager or operator.</p>}
      </section>
      <section className="card stack">
        <h3>Machine/human handoff</h3>
        <label>Last safe summary<textarea value={summary} onChange={event => setSummary(event.target.value)} maxLength={2000} rows={5} disabled={busy || !context} /></label>
        <label>Allowed next action<input value={nextAction} onChange={event => setNextAction(event.target.value)} maxLength={500} disabled={busy || !context} /></label>
        <div className="notice"><strong>Current owner</strong><span>{activeHandoff ? `${activeHandoff.currentOwner.type}:${activeHandoff.currentOwner.ref}` : actorLabel}</span><span>Shift: {selectedShiftId || 'none'}</span><span>Revision: {context?.handoffRevision ?? 0}</span></div>
        <button className="btn" type="button" disabled={busy || !context || !selectedShiftId} onClick={saveHandoff}>Save handoff</button>
      </section>
    </div>
    <section className="card stack">
      <h3>Grok roleplay turn</h3>
      {actor?.actor.type === 'llm' ? <>
        <p className="subtle">This is an explicit, auditable provider call for the selected LLM shift. The response is bounded, stored in this conversation’s memory, and never publishes to a social account.</p>
        <textarea value={turnPrompt} onChange={event => setTurnPrompt(event.target.value)} maxLength={4000} rows={4} disabled={!canEdit || busy || !context} placeholder="Write the next bounded roleplay prompt…" />
        {canEdit ? <button className="btn" type="button" disabled={busy || !context || !turnPrompt.trim()} onClick={() => void generateTurn()}>Generate bounded Grok reply</button> : <p className="subtle">Generating a provider turn requires an owner, manager or operator.</p>}
        {lastTurn && <div className="notice" role="status"><strong>Turn {lastTurn.state}</strong><span>Provider: {lastTurn.provider} · model: {lastTurn.providerModel}</span>{lastTurn.content && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{lastTurn.content}</p>}{lastTurn.providerRequestId && <span>Provider receipt: {lastTurn.providerRequestId}</span>}{lastTurn.errorCode && <span>Error code: {lastTurn.errorCode}</span>}</div>}
      </> : <p className="subtle">The selected actor is human. Use the handoff and bounded memory controls above; provider generation is available only when an active, approved LLM actor owns this chatter shift.</p>}
    </section>
    <section className="card stack">
      <h3>Bounded chat memory</h3>
      <p className="subtle">Only the most recent configured turns are retained. Each turn is labeled as user or assistant data and attributed to the selected actor.</p>
      <div className="stack">{context?.memory.length ? context.memory.map(turn => <article className="card" key={turn.sequence}><strong>{turn.role} · {turn.speaker.type}:{turn.speaker.ref}</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.content}</p></article>) : <p className="subtle">No saved memory for this conversation.</p>}</div>
      <div className="row"><label>Turn role<select value={memoryRole} onChange={event => setMemoryRole(event.target.value as 'user' | 'assistant')}><option value="user">User</option><option value="assistant">Assistant</option></select></label><label style={{ flex: 3 }}>Turn content<textarea value={memoryText} onChange={event => setMemoryText(event.target.value)} maxLength={4000} rows={3} disabled={busy || !context} placeholder="Add one bounded, auditable conversation turn…" /></label></div>
      <button className="btn secondary" type="button" disabled={busy || !context || !memoryText.trim()} onClick={() => void appendMemory()}>Save memory turn</button>
    </section>
  </div>;
}
