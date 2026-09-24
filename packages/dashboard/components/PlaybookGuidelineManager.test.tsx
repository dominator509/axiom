import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatNumber } from '@axiom/core';
import PlaybookGuidelineManager from './PlaybookGuidelineManager';
import LocaleProvider from './LocaleProvider';

vi.mock('./PlaybookHistory', () => ({ default: () => <div>History surface</div> }));

const guideline = {
  id: 'guideline-1', modelId: 'model-1', platform: 'instagram', optimalTimes: ['18:00'],
  cadencePerWeek: 3, upsellStrategy: 'Approved approach', revision: 4,
  updatedAt: '2030-01-01T00:00:00Z',
};

it('localizes editable playbook controls while preserving authored strategy text', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><PlaybookGuidelineManager modelId="model-1" initial={[guideline]} canEdit /></LocaleProvider>);
  expect(html).toContain('Directrices del playbook del modelo');
  expect(html).toContain('Horarios óptimos de publicación');
  expect(html).toContain('Estrategia de promoción');
  expect(html).toContain('Guardar directriz');
  expect(html).toContain('Approved approach');
  expect(html).not.toContain('Save guideline');
});

it('localizes the read-only owner boundary and hides save controls', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="de"><PlaybookGuidelineManager modelId="model-1" initial={[]} canEdit={false} /></LocaleProvider>);
  expect(html).toContain('Playbook-Richtlinien des Modells');
  expect(html).toContain('Änderungen an Richtlinien erfordern die Rolle Eigentümer, Manager oder Operator.');
  expect(html).not.toContain('Richtlinie speichern');
  expect(html).not.toContain('Save guideline');
});

it('formats the editable revision through the selected locale', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="de"><PlaybookGuidelineManager modelId="model-1" initial={[{ ...guideline, revision: 1234 }]} canEdit /></LocaleProvider>);
  expect(html).toContain(formatNumber(1234, 'de'));
  expect(html).not.toContain('revision 1234');
});
