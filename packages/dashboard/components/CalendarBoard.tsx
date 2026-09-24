'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { PostTarget } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { formatDate, readBoundedResponseJson, type SupportedLocale } from '@axiom/core';
import { useLocale } from './LocaleProvider';

const DAY_MS = 86_400_000;

export interface CalendarBoardProps {
  posts: PostTarget[];
  year: number;
  month: number;
  view: 'month' | 'week';
  weekStart?: string;
  canEdit: boolean;
}

export interface CalendarCell {
  key: string;
  label: string;
  date: Date;
  inCurrentMonth: boolean;
}

export function formatCalendarCount(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale).format(Number.isFinite(value) ? value : 0);
}

function utcDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfUtcWeek(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

export function calendarCells(year: number, month: number, view: 'month' | 'week', weekStart?: string, locale = 'en'): CalendarCell[] {
  if (view === 'week') {
    const parsed = weekStart ? new Date(`${weekStart}T00:00:00.000Z`) : new Date(Date.UTC(year, month - 1, 1));
    const start = startOfUtcWeek(Number.isNaN(parsed.getTime()) ? new Date(Date.UTC(year, month - 1, 1)) : parsed);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start.getTime() + index * DAY_MS);
      return { key: utcDayKey(date), label: date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }), date, inCurrentMonth: date.getUTCMonth() === month - 1 };
    });
  }

  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = ((gridStart.getUTCDate() + daysInMonth - 1) > 35) ? 42 : 35;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    return { key: utcDayKey(date), label: date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }), date, inCurrentMonth: date.getUTCMonth() === month - 1 };
  });
}

export function movedUtcSlot(post: PostTarget, target: Date) {
  const source = post.scheduledFor ? new Date(post.scheduledFor) : null;
  if (!source || Number.isNaN(source.getTime())) return null;
  return new Date(Date.UTC(
    target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),
    source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds(),
  )).toISOString();
}

export default function CalendarBoard({ posts, year, month, view, weekStart, canEdit }: CalendarBoardProps) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }), [locale]);
  const cells = useMemo(() => calendarCells(year, month, view, weekStart, locale), [locale, month, view, weekStart, year]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, index + 1)))), [locale]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [targetDates, setTargetDates] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const byDay = useMemo(() => {
    const grouped = new Map<string, PostTarget[]>();
    for (const post of posts) {
      if (!post.scheduledFor) continue;
      const date = new Date(post.scheduledFor);
      if (Number.isNaN(date.getTime())) continue;
      const key = utcDayKey(date);
      const day = grouped.get(key) ?? [];
      day.push(post);
      grouped.set(key, day);
    }
    return grouped;
  }, [posts]);

  async function submitMove(post: PostTarget | undefined, target: Date) {
    if (!post || busyId) return;
    if (!canEdit || post.state !== 'pending' || post.remoteId) return;
    const scheduledFor = movedUtcSlot(post, target);
    if (!scheduledFor) return;
    setBusyId(post.id); setError(''); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduledFor }),
      }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        throw new Error(details?.error?.message ?? t('calendar.scheduleChangeNotAccepted'));
      }
      const result = await readBoundedResponseJson(response) as { data?: { id?: unknown; state?: unknown; scheduledFor?: unknown } } | null;
      if (result?.data?.id !== post.id || result.data.state !== 'pending' || result.data.scheduledFor !== scheduledFor) {
        throw new Error(t('calendar.unconfirmedScheduleResponse'));
      }
      setMessage(`${t('calendar.movedNotice', { platform: post.platform, date: formatDate(new Date(scheduledFor), locale, { dateStyle: 'medium', timeZone: 'UTC' }) })} ${t('calendar.publicationGates')}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('calendar.changeNotConfirmed'));
    } finally {
      setBusyId(null);
    }
  }

  async function moveDraggedPost(target: Date) {
    if (!draggedId) return;
    const post = posts.find(candidate => candidate.id === draggedId);
    setDraggedId(null);
    await submitMove(post, target);
  }

  async function movePostToDate(post: PostTarget, value: string) {
    const target = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(target.getTime())) {
      setError(t('calendar.validUtcDate'));
      setMessage('');
      return;
    }
    await submitMove(post, target);
  }

  const viewLabel = t(view === 'month' ? 'calendar.month' : 'calendar.week');
  const stateLabel = (state: string) => {
    const key = `calendar.state.${state}`;
    const translated = t(key);
    return translated === key ? state : translated;
  };
  return <section className="card stack" aria-label={t('calendar.visualView', { view: viewLabel })}>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <h3 style={{ margin: 0 }}>{t('calendar.visualView', { view: viewLabel })}</h3>
        <p className="subtle" style={{ marginBottom: 0 }}>{t('calendar.dragHint')}</p>
      </div>
      <span className="badge mute">{t('calendar.loaded', { count: formatCalendarCount(posts.length, locale) })}</span>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, overflowX: 'auto' }}>
      {weekdays.map(day => <strong key={day} style={{ minWidth: 108, color: 'var(--muted)', fontSize: 12 }}>{day}</strong>)}
      {cells.map(cell => {
        const dayPosts = byDay.get(cell.key) ?? [];
        return <div
          key={cell.key}
          aria-label={t('calendar.dayAria', { label: cell.label })}
          onDragOver={event => { if (canEdit) event.preventDefault(); }}
          onDrop={event => { event.preventDefault(); void moveDraggedPost(cell.date); }}
          style={{ minWidth: 108, minHeight: 128, padding: 8, border: `1px solid ${cell.inCurrentMonth ? 'var(--line)' : 'transparent'}`, borderRadius: 10, background: cell.inCurrentMonth ? 'var(--panel2)' : 'transparent', opacity: cell.inCurrentMonth ? 1 : .65 }}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span className="mono" style={{ fontSize: 12 }}>{cell.label}</span>{dayPosts.length > 0 && <span className="badge mute">{formatCalendarCount(dayPosts.length, locale)}</span>}</div>
          <div className="stack" style={{ gap: 6 }}>
            {dayPosts.map(post => {
              const editable = canEdit && post.state === 'pending' && !post.remoteId;
              return <article
                key={post.id}
                id={`calendar-post-${post.id}`}
                draggable={editable}
                onDragStart={() => { if (editable) setDraggedId(post.id); }}
                onDragEnd={() => setDraggedId(null)}
                className="card"
                style={{ padding: 8, cursor: editable ? 'grab' : 'default' }}
              >
                <Link href={`#post-${post.id}`} style={{ fontWeight: 600 }}>{post.platform}</Link>
                <span className={`badge ${post.state === 'published' ? 'good' : post.state === 'failed' ? 'bad' : 'mute'}`}>{stateLabel(post.state)}</span>
                <span className="subtle" style={{ fontSize: 12 }}>{post.scheduledFor ? timeFormatter.format(new Date(post.scheduledFor)) : t('calendar.unscheduled')} {t('calendar.utc')}</span>
                {editable && <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                  <label htmlFor={`move-date-${post.id}`} className="subtle" style={{ fontSize: 12 }}>{t('calendar.moveToUtcDate')}</label>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      id={`move-date-${post.id}`}
                      type="date"
                      value={targetDates[post.id] ?? post.scheduledFor?.slice(0, 10) ?? ''}
                      onChange={event => setTargetDates(current => ({ ...current, [post.id]: event.target.value }))}
                      aria-label={t('calendar.movePostToDate', { platform: post.platform })}
                    />
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void movePostToDate(post, targetDates[post.id] ?? post.scheduledFor?.slice(0, 10) ?? '')}
                    >{t('calendar.move')}</button>
                  </div>
                </div>}
              </article>;
            })}
          </div>
        </div>;
      })}
    </div>
    {busyId && <p className="subtle" role="status">{t('calendar.savingOriginal')}</p>}
    <p className="subtle" style={{ marginBottom: 0 }}>{t('calendar.lockedExplanation')}</p>
  </section>;
}
