import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DigestScheduleStatus from './DigestScheduleStatus';

it('distinguishes unavailable, disabled and enabled without a job', () => {
  expect(renderToStaticMarkup(<DigestScheduleStatus schedule={undefined} canConfigure={false} />)).toContain('unavailable');
  expect(renderToStaticMarkup(<DigestScheduleStatus schedule={{ enabled: false, workspacePermitted: true, latest: null }} canConfigure={false} />)).toContain('are off');
  const html = renderToStaticMarkup(<DigestScheduleStatus schedule={{ enabled: true, workspacePermitted: false, latest: null }} canConfigure />);
  expect(html).toContain('no scheduled job'); expect(html).toContain('Safety permission is off'); expect(html).toContain('/settings');
});
it.each([['ready', 'queued'], ['running', 'running'], ['dead', 'failed'], ['done', 'no later job'], ['unexpected', 'operator review']])('renders actual %s state without claiming delivery', (state, message) => {
  const html = renderToStaticMarkup(<DigestScheduleStatus schedule={{ enabled: true, workspacePermitted: true, latest: { state, runAfter: '2026-09-21T00:00:00Z', attempts: 3 } }} canConfigure={false} />);
  expect(html).toContain(message); expect(html).toContain('Attempts: 3');
  expect(html).toContain('not confirm an external Relay'); expect(html).not.toContain('/settings');
});
