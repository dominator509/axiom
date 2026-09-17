import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RequestedSchedule from './RequestedSchedule';
it('discloses saved timing in UTC and distinguishes a request from publication', () => {
  const html = renderToStaticMarkup(<RequestedSchedule intent={{ action: 'schedule', platform: 'x', scheduledAt: '2099-06-15T12:30:00Z' }} />);
  expect(html).toContain('2099-06-15 12:30:00 UTC');
  expect(html).toContain('not approved or queued');
  expect(html).toContain('explicit approval slot overrides');
});
it('does not hide malformed timing or invent a request when absent', () => {
  expect(renderToStaticMarkup(<RequestedSchedule intent={{ action: 'schedule', platform: 'x', scheduledAt: null }} />)).toContain('saved schedule request is invalid');
  expect(renderToStaticMarkup(<RequestedSchedule intent={null} />)).toBe('');
});
