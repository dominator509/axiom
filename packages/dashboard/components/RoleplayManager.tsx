'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber, type SupportedLocale } from '@axiom/core';
import type {
  RoleplayActor,
  RoleplayHandoff,
  RoleplayMemoryTurn,
  RoleplayPersona,
  RoleplayTurnReceipt,
  RoleplayTurnResult,
} from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import {
  getRoleplayPersonalitySuggestion,
  ROLEPLAY_PERSONALITY_SUGGESTIONS,
  type RoleplayPersonalityKey,
} from '@/lib/roleplay-personality';
import { useLocale } from './LocaleProvider';

export function formatRoleplayCount(value: number, locale: SupportedLocale): string {
  return formatNumber(value, locale);
}

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
  turns: RoleplayTurnReceipt[];
  meta: { nextSequence: number; activeShiftId: string; queue: string; actor: RoleplayActor };
}

export default function RoleplayManager({
  modelId,
  actorOptions,
  canEdit,
}: {
  modelId: string;
  actorOptions: RoleplayActorOption[];
  canEdit: boolean;
}) {
  const { locale, t } = useLocale();
  const [actor, setActor] = useState<RoleplayActorOption | null>(actorOptions[0] ?? null);
  const [conversationKey, setConversationKey] = useState('default');
  const [context, setContext] = useState<RoleplayContext | null>(null);
  const [personaText, setPersonaText] = useState('');
  const [personaMode, setPersonaMode] = useState<'suggested' | 'manual'>('manual');
  const [suggestionKey, setSuggestionKey] = useState<RoleplayPersonalityKey>(
    ROLEPLAY_PERSONALITY_SUGGESTIONS[0].key,
  );
  const [summary, setSummary] = useState('');
  const [nextAction, setNextAction] = useState('');
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
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const query = new URLSearchParams({
        conversationKey,
        actorType: actor.actor.type,
        actorRef: actor.actor.ref,
      });
      const response = await fetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/roleplay?${query}`,
        { cache: 'no-store', signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(t('roleplay.contextUnavailable'));
      const body = await readDashboardJson<{ data: RoleplayContext }>(response);
      if (!body.data?.meta?.activeShiftId || body.data.meta.actor?.ref !== actor.actor.ref)
        throw new Error(t('roleplay.contextUnconfirmed'));
      setContext(body.data);
      setPersonaText(body.data.persona?.content ?? '');
      setSummary(body.data.handoff?.lastSafeSummary ?? '');
      setNextAction(body.data.handoff?.allowedNextAction ?? t('roleplay.defaultNextAction'));
    } catch {
      setContext(null);
      setError(t('roleplay.contextUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setLastTurn(null);
    void load();
  }, [actorKey, conversationKey]);

  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        path,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        { idempotencyKey: createIdempotencyKey(), retries: 0 },
      );
      if (!response.ok) throw new Error(t('roleplay.changeRejected'));
      await readDashboardJson<{ data: unknown }>(response);
      setMessage(success);
      await load();
    } catch {
      setError(t('roleplay.changeUnconfirmed'));
    } finally {
      setBusy(false);
    }
  }

  async function loadPersonaFile(file: File) {
    setError('');
    setMessage('');
    if (file.size > 32 * 1024) {
      setError(t('roleplay.personaFileTooLarge'));
      return;
    }
    try {
      const text = await file.text();
      if (text.length > 8_000) {
        setError(t('roleplay.personaFileTooLarge'));
        return;
      }
      setPersonaMode('manual');
      setPersonaText(text);
      setMessage(t('roleplay.personaFileLoaded', { name: file.name }));
    } catch {
      setError(t('roleplay.personaFileReadFailed'));
    }
  }

  function useSuggestedPersonality() {
    if (!canEdit || busy) return;
    const suggestion = getRoleplayPersonalitySuggestion(suggestionKey);
    if (!suggestion) return;
    setError('');
    setPersonaMode('suggested');
    setPersonaText(suggestion.content);
    setMessage(t('roleplay.suggestionLoaded', { label: suggestion.label }));
  }

  function enableManualPersonality() {
    if (!canEdit || busy) return;
    setError('');
    setPersonaMode('manual');
    setMessage(t('roleplay.manualModeEnabled'));
  }

  function savePersona() {
    if (!canEdit || !context) return;
    void mutate(
      `/api/v1/models/${encodeURIComponent(modelId)}/roleplay/persona`,
      {
        expectedRevision: context.persona?.revision ?? 0,
        sourceRef: 'soul.md',
        content: personaText,
      },
      t('roleplay.personaSaved'),
    );
  }

  function saveHandoff() {
    if (!context || !actor || !selectedShiftId) return;
    const handoff: RoleplayHandoff = activeHandoff
      ? {
          ...activeHandoff,
          actor: actor.actor,
          shiftId: selectedShiftId,
          queue: context.meta.queue,
          lastSafeSummary: summary,
          allowedNextAction: nextAction,
        }
      : {
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
    void mutate(
      `/api/v1/models/${encodeURIComponent(modelId)}/roleplay/handoff`,
      { conversationKey, expectedRevision: context.handoffRevision, handoff },
      t('roleplay.handoffSaved'),
    );
  }

  async function appendMemory() {
    if (!context || !actor || !memoryText.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/roleplay/memory`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationKey,
            sequence: context.meta.nextSequence,
            role: memoryRole,
            speaker: actor.actor,
            content: memoryText.trim(),
          }),
        },
        { idempotencyKey: createIdempotencyKey(), retries: 0 },
      );
      if (!response.ok) throw new Error(t('roleplay.memoryTurnRejected'));
      await readDashboardJson<{ data: unknown }>(response);
      setMemoryText('');
      setMessage(t('roleplay.memoryTurnSaved'));
      await load();
    } catch {
      setError(t('roleplay.memoryTurnUnconfirmed'));
    } finally {
      setBusy(false);
    }
  }

  async function generateTurn() {
    if (!canEdit || !context || !actor || actor.actor.type !== 'llm' || !turnPrompt.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/roleplay/turn`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationKey,
            intentKey: globalThis.crypto.randomUUID(),
            actor: actor.actor,
            content: turnPrompt.trim(),
            confirm: true,
          }),
        },
        { idempotencyKey: createIdempotencyKey(), retries: 0 },
      );
      if (!response.ok) throw new Error(t('roleplay.grokTurnRejected'));
      const body = await readDashboardJson<{ data: RoleplayTurnResult }>(response);
      setLastTurn(body.data);
      setTurnPrompt('');
      await load();
      setMessage(t('roleplay.grokTurnSaved'));
    } catch {
      await load();
      setError(t('roleplay.grokTurnUnconfirmed'));
    } finally {
      setBusy(false);
    }
  }

  const actorLabel = useMemo(() => (actor ? actor.label : t('roleplay.noActiveActor')), [actor, t]);
  return (
    <div className="page-stack">
      <div className="card stack">
        <h2>{t('roleplay.title')}</h2>
        <p className="subtle">{t('roleplay.description')}</p>
        <div className="row">
          <label>
            {t('roleplay.conversationKey')}
            <input
              value={conversationKey}
              onChange={(event) => setConversationKey(event.target.value)}
              maxLength={128}
            />
          </label>
          <label>
            {t('roleplay.activeActor')}
            <select
              value={actorKey}
              onChange={(event) =>
                setActor(
                  actorOptions.find(
                    (option) => `${option.actor.type}:${option.actor.ref}` === event.target.value,
                  ) ?? null,
                )
              }
            >
              {actorOptions.length === 0 && <option value="">{t('roleplay.noActiveActor')}</option>}
              {actorOptions.map((option) => (
                <option
                  key={`${option.actor.type}:${option.actor.ref}`}
                  value={`${option.actor.type}:${option.actor.ref}`}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="subtle">
          {t('roleplay.selectedSummary', {
            actor: actorLabel,
            queue: context?.meta.queue ?? actor?.queue ?? t('roleplay.none'),
          })}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button
          className="btn secondary"
          type="button"
          disabled={busy || !actor}
          onClick={() => void load()}
        >
          {t('roleplay.reloadContext')}
        </button>
      </div>
      <div className="grid">
        <section className="card stack">
          <h3>{t('roleplay.personaTitle')}</h3>
          <p className="subtle">{t('roleplay.personaDescription')}</p>
          <div className="stack" aria-label={t('roleplay.personaOptions')}>
            <label>
              {t('roleplay.suggestedPersonality')}
              <select
                value={suggestionKey}
                disabled={!canEdit || busy}
                onChange={(event) => setSuggestionKey(event.target.value as RoleplayPersonalityKey)}
              >
                {ROLEPLAY_PERSONALITY_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion.key} value={suggestion.key}>
                    {suggestion.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="subtle">{getRoleplayPersonalitySuggestion(suggestionKey)?.description}</p>
            <div className="row">
              <button
                className={`btn${personaMode === 'suggested' ? '' : ' secondary'}`}
                type="button"
                disabled={!canEdit || busy}
                aria-pressed={personaMode === 'suggested'}
                onClick={useSuggestedPersonality}
              >
                {t('roleplay.useSuggested')}
              </button>
              <button
                className={`btn${personaMode === 'manual' ? '' : ' secondary'}`}
                type="button"
                disabled={!canEdit || busy}
                aria-pressed={personaMode === 'manual'}
                onClick={enableManualPersonality}
              >
                {t('roleplay.writeManually')}
              </button>
            </div>
            <p className="subtle">
              {t('roleplay.modeDescription', {
                mode:
                  personaMode === 'suggested'
                    ? t('roleplay.modeSuggested')
                    : t('roleplay.modeManual'),
              })}
            </p>
          </div>
          <label>
            {t('roleplay.loadPersona')}
            <input
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              disabled={!canEdit || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (file) void loadPersonaFile(file);
              }}
            />
          </label>
          <textarea
            value={personaText}
            onChange={(event) => setPersonaText(event.target.value)}
            maxLength={8000}
            rows={12}
            placeholder={t('roleplay.personaPlaceholder')}
            disabled={!canEdit || busy}
          />
          <p className="subtle">
            {t('roleplay.personaRevision', {
              revision: formatRoleplayCount(context?.persona?.revision ?? 0, locale),
              count: formatRoleplayCount(personaText.length, locale),
            })}
          </p>
          {canEdit ? (
            <button
              className="btn"
              type="button"
              disabled={busy || !context || !personaText.trim()}
              onClick={savePersona}
            >
              {t('roleplay.savePersona')}
            </button>
          ) : (
            <p className="subtle">{t('roleplay.personaEditRequires')}</p>
          )}
        </section>
        <section className="card stack">
          <h3>{t('roleplay.handoffTitle')}</h3>
          <label>
            {t('roleplay.lastSafeSummary')}
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={2000}
              rows={5}
              disabled={busy || !context}
            />
          </label>
          <label>
            {t('roleplay.allowedNextAction')}
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              maxLength={500}
              disabled={busy || !context}
            />
          </label>
          <div className="notice">
            <strong>{t('roleplay.currentOwner')}</strong>
            <span>
              {activeHandoff
                ? `${activeHandoff.currentOwner.type}:${activeHandoff.currentOwner.ref}`
                : actorLabel}
            </span>
            <span>
              {t('roleplay.shift')}: {selectedShiftId || t('roleplay.none')}
            </span>
            <span>
              {t('roleplay.revision')}: {formatRoleplayCount(context?.handoffRevision ?? 0, locale)}
            </span>
          </div>
          <button
            className="btn"
            type="button"
            disabled={busy || !context || !selectedShiftId}
            onClick={saveHandoff}
          >
            {t('roleplay.saveHandoff')}
          </button>
        </section>
      </div>
      <section className="card stack">
        <h3>{t('roleplay.grokTitle')}</h3>
        {actor?.actor.type === 'llm' ? (
          <>
            <p className="subtle">{t('roleplay.grokDescription')}</p>
            <textarea
              value={turnPrompt}
              onChange={(event) => setTurnPrompt(event.target.value)}
              maxLength={4000}
              rows={4}
              disabled={!canEdit || busy || !context}
              placeholder={t('roleplay.turnPlaceholder')}
            />
            {canEdit ? (
              <button
                className="btn"
                type="button"
                disabled={busy || !context || !turnPrompt.trim()}
                onClick={() => void generateTurn()}
              >
                {t('roleplay.generateGrok')}
              </button>
            ) : (
              <p className="subtle">{t('roleplay.providerRequiresRole')}</p>
            )}
            {lastTurn && (
              <div className="notice" role="status">
                <strong>{t('roleplay.turnState', { state: lastTurn.state })}</strong>
                <span>
                  {t('roleplay.providerModel', {
                    provider: lastTurn.provider,
                    model: lastTurn.providerModel,
                  })}
                </span>
                {lastTurn.content && (
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {lastTurn.content}
                  </p>
                )}
                {lastTurn.providerRequestId && (
                  <span>{t('roleplay.providerReceipt', { id: lastTurn.providerRequestId })}</span>
                )}
                {lastTurn.errorCode && (
                  <span>{t('roleplay.errorCode', { code: lastTurn.errorCode })}</span>
                )}
              </div>
            )}
            <div className="stack">
              <strong>{t('roleplay.recentReceipts')}</strong>
              {context?.turns?.length ? (
                context.turns.map((turn) => (
                  <article className="card" key={turn.turnId}>
                    <strong>
                      {t('roleplay.receiptState', {
                        state: turn.state,
                        provider: turn.provider,
                        model: turn.providerModel,
                      })}
                    </strong>
                    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {turn.state === 'completed'
                        ? turn.content
                        : turn.errorCode
                          ? t('roleplay.noReplyStored', { code: turn.errorCode })
                          : t('roleplay.noReplyStoredYet')}
                    </p>
                    <span className="subtle">
                      {t('roleplay.requestPrompt', {
                        request: turn.providerRequestId ?? t('roleplay.notConfirmed'),
                        prompt: turn.input,
                      })}
                    </span>
                  </article>
                ))
              ) : (
                <p className="subtle">{t('roleplay.noProviderTurns')}</p>
              )}
            </div>
          </>
        ) : (
          <p className="subtle">{t('roleplay.humanActorDescription')}</p>
        )}
      </section>
      <section className="card stack">
        <h3>{t('roleplay.memoryTitle')}</h3>
        <p className="subtle">{t('roleplay.memoryDescription')}</p>
        <div className="stack">
          {context?.memory.length ? (
            context.memory.map((turn) => (
              <article className="card" key={turn.sequence}>
                <strong>
                  {t('roleplay.memoryTurnMeta', {
                    role: turn.role,
                    speaker: `${turn.speaker.type}:${turn.speaker.ref}`,
                  })}
                </strong>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.content}</p>
              </article>
            ))
          ) : (
            <p className="subtle">{t('roleplay.noSavedMemory')}</p>
          )}
        </div>
        <div className="row">
          <label>
            {t('roleplay.turnRole')}
            <select
              value={memoryRole}
              onChange={(event) => setMemoryRole(event.target.value as 'user' | 'assistant')}
            >
              <option value="user">{t('roleplay.user')}</option>
              <option value="assistant">{t('roleplay.assistant')}</option>
            </select>
          </label>
          <label style={{ flex: 3 }}>
            {t('roleplay.turnContent')}
            <textarea
              value={memoryText}
              onChange={(event) => setMemoryText(event.target.value)}
              maxLength={4000}
              rows={3}
              disabled={busy || !context}
              placeholder={t('roleplay.memoryPlaceholder')}
            />
          </label>
        </div>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || !context || !memoryText.trim()}
          onClick={() => void appendMemory()}
        >
          {t('roleplay.saveMemory')}
        </button>
      </section>
    </div>
  );
}
