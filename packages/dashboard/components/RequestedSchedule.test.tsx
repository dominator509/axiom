import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatDate } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import RequestedSchedule from './RequestedSchedule';

const scheduledAt = new Date('2099-06-15T12:30:00Z');

function render(locale: 'en' | 'es' | 'ja' = 'en', intent: Parameters<typeof RequestedSchedule>[0]['intent'] = { action: 'schedule', platform: 'x', scheduledAt: scheduledAt.toISOString() }) {
  return renderToStaticMarkup(<LocaleProvider initialLocale={locale}><RequestedSchedule intent={intent} /></LocaleProvider>);
}

it('discloses saved timing in UTC and distinguishes a request from publication', () => {
  const html = render();
  expect(html).toContain('Requested schedule for x');
  expect(html).toContain(`${formatDate(scheduledAt, 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`);
  expect(html).toContain('not approved or queued');
  expect(html).toContain('explicit approval slot overrides');
});

it.each([
  ['es', 'Horario solicitado para x'],
  ['ja', 'x の要求されたスケジュール'],
] as const)('uses the selected locale for %s approval copy and time formatting', (locale, heading) => {
  const html = render(locale);
  expect(html).toContain(heading);
  expect(html).toContain(`${formatDate(scheduledAt, locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`);
});

it('does not hide malformed timing or invent a request when absent', () => {
  expect(render('es', { action: 'schedule', platform: 'x', scheduledAt: null })).toContain('La solicitud de horario guardada no es válida');
  expect(render('en', null)).toBe('');
});
