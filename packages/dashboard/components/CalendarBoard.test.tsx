import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarBoard, { calendarCells, movedUtcSlot } from './CalendarBoard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({
  locale: 'en',
  t: (key: string, values?: Record<string, string | number>) => ({
    'calendar.month': 'month',
    'calendar.visualView': `Visual ${values?.view ?? 'month'} view`,
    'calendar.dragHint': 'Times are shown in UTC. Drag an editable pending post to another day to request a guarded reschedule.',
    'calendar.loaded': `${values?.count ?? 0} loaded`,
    'calendar.dayAria': `Calendar day ${values?.label ?? ''}`,
    'calendar.moveToUtcDate': 'Move to UTC date',
    'calendar.movePostToDate': `Move ${values?.platform ?? ''} post to UTC date`,
    'calendar.move': 'Move',
    'calendar.utc': 'UTC',
    'calendar.unscheduled': 'unscheduled',
    'calendar.savingOriginal': 'Saving the original drag request…',
    'calendar.lockedExplanation': 'A drag changes only an editable pending target. Published, handed-off, failed, canceled, or uncertain targets remain locked by the API.',
  }[key] ?? key),
}) }));

const post = (id: string, scheduledFor: string, state = 'pending', remoteId: string | null = null) => ({
  id, bundleId: 'bundle', platform: 'x', scheduledFor, state, remoteId, error: null,
});

describe('calendar visual board', () => {
  it('creates a Monday-first month grid and a seven-day week grid', () => {
    expect(calendarCells(2030, 2, 'month').length).toBe(42);
    expect(calendarCells(2030, 2, 'month')[0].key).toBe('2030-01-28');
    expect(calendarCells(2030, 2, 'week', '2030-02-20').map(cell => cell.key)).toEqual([
      '2030-02-18', '2030-02-19', '2030-02-20', '2030-02-21', '2030-02-22', '2030-02-23', '2030-02-24',
    ]);
  });

  it('renders guarded drag affordances only for editable pending targets', () => {
    const html = renderToStaticMarkup(<CalendarBoard
      year={2030}
      month={2}
      view="month"
      canEdit
      posts={[post('pending', '2030-02-20T18:30:00Z'), post('published', '2030-02-20T19:30:00Z', 'published', 'remote')]}
    />);
    expect(html).toContain('Visual month view');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('Drag an editable pending post to another day');
    expect(html).toContain('Move to UTC date');
    expect(html).toContain('aria-label="Move x post to UTC date"');
  });

  it('preserves the original UTC time when a keyboard/date move changes the day', () => {
    expect(movedUtcSlot(post('pending', '2030-02-20T18:30:45.000Z'), new Date('2030-02-24T00:00:00.000Z')))
      .toBe('2030-02-24T18:30:45.000Z');
  });
});
