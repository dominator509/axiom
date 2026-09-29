import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocalDateTime, { formatLocalDateTime } from './LocalDateTime';

describe('local profile timestamps', () => {
  it('formats the stored instant in the viewer timezone', () => {
    expect(formatLocalDateTime('2026-09-26T03:57:00.000Z', 'en', 'America/Los_Angeles'))
      .toBe('Sep 25, 2026, 8:57 PM');
    expect(formatLocalDateTime('2026-09-26T03:57:00.000Z', 'en', 'America/Chicago'))
      .toBe('Sep 25, 2026, 10:57 PM');
  });

  it('renders the same UTC fallback on the server and first client render', () => {
    const html = renderToStaticMarkup(<LocalDateTime value="2026-09-26T03:57:00.000Z" fallback="Sep 26, 2026, 3:57 AM" />);
    expect(html).toBe('<time dateTime="2026-09-26T03:57:00.000Z">Sep 26, 2026, 3:57 AM</time>');
  });
});
