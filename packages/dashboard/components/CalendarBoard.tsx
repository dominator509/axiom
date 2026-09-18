'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { PostTarget } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { readBoundedResponseJson } from '@axiom/core';

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

function utcDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfUtcWeek(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

export function calendarCells(year: number, month: number, view: 'month' | 'week', weekStart?: string): CalendarCell[] {
  if (view === 'week') {
    const parsed = weekStart ? new Date(`${weekStart}T00:00:00.000Z`) : new Date(Date.UTC(year, month - 1, 1));
    const start = startOfUtcWeek(Number.isNaN(parsed.getTime()) ? new Date(Date.UTC(year, month - 1, 1)) : parsed);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start.getTime() + index * DAY_MS);
      return { key: utcDayKey(date), label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }), date, inCurrentMonth: date.getUTCMonth() === month - 1 };
    });
  }

  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = ((gridStart.getUTCDate() + daysInMonth - 1) > 35) ? 42 : 35;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    return { key: utcDayKey(date), label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }), date, inCurrentMonth: date.getUTCMonth() === month - 1 };
  });
}

function movedUtcSlot(post: PostTarget, target: Date) {
  const source = post.scheduledFor ? new Date(post.scheduledFor) : null;
  if (!source || Number.isNaN(source.getTime())) return null;
  return new Date(Date.UTC(
    target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(),
    source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds(),
  )).toISOString();
}

export default function CalendarBoard({ posts, year, month, view, weekStart, canEdit }: CalendarBoardProps) {
  const router = useRouter();
  const cells = useMemo(() => calendarCells(year, month, view, weekStart), [month, view, weekStart, year]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  async function movePost(target: Date) {
    if (!draggedId || busyId) return;
    const post = posts.find(candidate => candidate.id === draggedId);
    setDraggedId(null);
    if (!post || !canEdit || post.state !== 'pending' || post.remoteId) return;
    const scheduledFor = movedUtcSlot(post, target);
    if (!scheduledFor) return;
    setBusyId(post.id); setError(''); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduledFor }),
      }, { idempotencyKey: createIdempotencyKey(), retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        throw new Error(details?.error?.message ?? 'Schedule change was not accepted.');
      }
      const result = await readBoundedResponseJson(response) as { data?: { id?: unknown; state?: unknown; scheduledFor?: unknown } } | null;
      if (result?.data?.id !== post.id || result.data.state !== 'pending' || result.data.scheduledFor !== scheduledFor) {
        throw new Error('Unconfirmed schedule response.');
      }
      setMessage(`Moved ${post.platform} to ${scheduledFor.slice(0, 10)} UTC. Publication still requires the normal worker and provider gates.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Schedule change was not confirmed. Refresh before retrying.');
    } finally {
      setBusyId(null);
    }
  }

  return <section className="card stack" aria-label={`${view === 'month' ? 'Month' : 'Week'} visual calendar`}>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <h3 style={{ margin: 0 }}>Visual {view} view</h3>
        <p className="subtle" style={{ marginBottom: 0 }}>Times are shown in UTC. Drag an editable pending post to another day to request a guarded reschedule.</p>
      </div>
      <span className="badge mute">{posts.length} loaded</span>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, overflowX: 'auto' }}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <strong key={day} style={{ minWidth: 108, color: 'var(--muted)', fontSize: 12 }}>{day}</strong>)}
      {cells.map(cell => {
        const dayPosts = byDay.get(cell.key) ?? [];
        return <div
          key={cell.key}
          aria-label={`Calendar day ${cell.label}`}
          onDragOver={event => { if (canEdit) event.preventDefault(); }}
          onDrop={event => { event.preventDefault(); void movePost(cell.date); }}
          style={{ minWidth: 108, minHeight: 128, padding: 8, border: `1px solid ${cell.inCurrentMonth ? 'var(--line)' : 'transparent'}`, borderRadius: 10, background: cell.inCurrentMonth ? 'var(--panel2)' : 'transparent', opacity: cell.inCurrentMonth ? 1 : .65 }}
        >
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span className="mono" style={{ fontSize: 12 }}>{cell.key}</span>{dayPosts.length > 0 && <span className="badge mute">{dayPosts.length}</span>}</div>
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
                <span className={`badge ${post.state === 'published' ? 'good' : post.state === 'failed' ? 'bad' : 'mute'}`}>{post.state}</span>
                <span className="subtle" style={{ fontSize: 12 }}>{post.scheduledFor ? new Date(post.scheduledFor).toISOString().slice(11, 16) : 'unscheduled'} UTC</span>
              </article>;
            })}
          </div>
        </div>;
      })}
    </div>
    {busyId && <p className="subtle" role="status">Saving the original drag request…</p>}
    <p className="subtle" style={{ marginBottom: 0 }}>A drag changes only an editable pending target. Published, handed-off, failed, canceled, or uncertain targets remain locked by the API.</p>
  </section>;
}
