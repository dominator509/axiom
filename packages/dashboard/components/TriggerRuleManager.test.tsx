import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TriggerRuleManager from './TriggerRuleManager';
import LocaleProvider from './LocaleProvider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const rule = {
  id: 'rule-1', modelId: 'model-1', name: 'Viral follow-up', platform: 'instagram',
  condition: { metric: 'likes' as const, threshold: 100 },
  action: { type: 'content.generate' as const, style: 'follow-up', cooldownMinutes: 120 },
  enabled: true, lastFiredAt: null, createdAt: '2030-01-01T00:00:00Z',
};

const firedRule = { ...rule, id: 'rule-fired', lastFiredAt: '2030-01-01T00:15:00Z' };
const localizedThresholdRule = { ...rule, id: 'rule-localized-threshold', condition: { ...rule.condition, threshold: 12345.5 } };
const learnedRule = { ...rule, id: 'rule-learned', condition: { metric: 'likes' as const, thresholdMode: 'learned_p90' as const, minimumSamples: 4 } };

it('localizes editable trigger-rule controls while preserving authored rule names', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TriggerRuleManager modelId="model-1" rules={[rule]} canEdit /></LocaleProvider>);
  expect(html).toContain('Elige una plataforma, qué quieres medir (por ejemplo, los me gusta o las visualizaciones) y un objetivo.');
  expect(html).toContain('Deshabilitar');
  expect(html).toContain('Eliminar');
  expect(html).toContain('Crear una regla para publicaciones');
  expect(html).toContain('Preparar contenido de seguimiento');
  expect(html).toContain('me gusta');
  expect(html).toContain('Viral follow-up');
  expect(html).not.toContain('Disable');
  expect(html).not.toContain('Save trigger rule');
});

it('explains the value, trigger, and actions of post rules in plain language', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="en"><TriggerRuleManager modelId="model-1" rules={[]} canEdit /></LocaleProvider>);
  expect(html).toContain('Choose a platform, what to measure (such as likes, comments, or views), and a target.');
  expect(html).toContain('prepare follow-up content for review');
  expect(html).toContain('send your team a Relay reminder');
  expect(html).toContain('without checking every post by hand');
  expect(html).toContain('Generated content still needs approval before it can be published.');
  expect(html).toContain('How should the target be set?');
  expect(html).toContain('Use a number you choose');
  expect(html).toContain('Compare with recent performance');
  expect(html).not.toContain('Learned p90');
  expect(html).not.toContain('worker gates');
});

it('formats last-fired values with the shared locale-aware UTC formatter', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TriggerRuleManager modelId="model-1" rules={[firedRule]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('2030');
  expect(html).not.toContain('T00:15:00.000Z');
});

it('formats trigger thresholds through the selected locale', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TriggerRuleManager modelId="model-1" rules={[localizedThresholdRule]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('12.345,5');
  expect(html).not.toContain('12345.5');
});

it('renders learned trigger thresholds without inventing a fixed value', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TriggerRuleManager modelId="model-1" rules={[learnedRule]} canEdit /></LocaleProvider>);
  expect(html).toContain('Comparar con resultados recientes');
  expect(html).toContain('necesita al menos 4');
  expect(html).toContain('¿Cómo quieres fijar el objetivo?');
  expect(html).not.toContain('≥ 0');
});

it('localizes the read-only owner boundary and hides mutation controls', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="de"><TriggerRuleManager modelId="model-1" rules={[]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('Für dieses Talent gibt es noch keine Regeln zur Beitragsleistung.');
  expect(html).toContain('Regeländerungen erfordern die Rolle Eigentümer, Manager oder Operator.');
  expect(html).not.toContain('Triggerregel speichern');
  expect(html).not.toContain('Löschen');
});
