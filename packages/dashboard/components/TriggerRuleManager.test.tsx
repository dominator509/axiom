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

it('localizes editable trigger-rule controls while preserving authored rule names', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><TriggerRuleManager modelId="model-1" rules={[rule]} canEdit /></LocaleProvider>);
  expect(html).toContain('Las reglas reaccionan a métricas de proveedores almacenadas.');
  expect(html).toContain('Deshabilitar');
  expect(html).toContain('Eliminar');
  expect(html).toContain('Crear regla de activación');
  expect(html).toContain('Generar seguimiento');
  expect(html).toContain('me gusta');
  expect(html).toContain('Viral follow-up');
  expect(html).not.toContain('Disable');
  expect(html).not.toContain('Save trigger rule');
});

it('localizes the read-only owner boundary and hides mutation controls', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="de"><TriggerRuleManager modelId="model-1" rules={[]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('Für dieses Talent sind keine Triggerregeln gespeichert.');
  expect(html).toContain('Regeländerungen erfordern die Rolle Eigentümer, Manager oder Operator.');
  expect(html).not.toContain('Triggerregel speichern');
  expect(html).not.toContain('Löschen');
});
