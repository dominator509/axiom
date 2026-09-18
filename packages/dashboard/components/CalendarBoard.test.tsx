import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CalendarBoard, { calendarCells } from './CalendarBoard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
  });
});
