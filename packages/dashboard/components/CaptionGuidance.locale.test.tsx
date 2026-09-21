import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'es',
    setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
        'caption.guidance': 'Orientación de subtítulos',
        'caption.guidanceDescription': 'Qué informó el subtítulo generado.',
        'caption.shortQuestion': 'Subtítulo corto con pregunta',
        'caption.hook': 'gancho',
        'caption.format': 'formato',
        'caption.noReceipt': 'No hay recibo de orientación de generación.',
        'caption.invalidReceipt': 'No se pudo verificar la evidencia de orientación.',
        'caption.changed': 'El subtítulo cambió desde la generación.',
        'caption.unknownStructure': 'Estructura de subtítulo desconocida',
        'caption.unknown': 'desconocido',
        'caption.noStructure': 'No se seleccionó una estructura de subtítulo aprendida',
        'caption.priorExamples': 'Se proporcionaron {count} ejemplo(s) anterior(es).',
        'caption.noScheduledContext': 'No había contexto de hora programada.',
        'caption.selectionContext': 'Contexto de selección: {from}:00–{to}:59 UTC.',
      }[key] ?? key);
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, name: string) => String(values?.[name] ?? _match));
    },
  }),
}));
import CaptionGuidance from './CaptionGuidance';

const caption = 'Original caption?';
const receipt = { version: 'caption-guidance-v1' as const, selectedArm: 'short:question',
  context: 'learn-v1:scheduled-utc-3', exemplarIds: ['11111111-1111-4111-8111-111111111111'],
  captionSha256: createHash('sha256').update(caption).digest('hex') };

describe('CaptionGuidance locale coverage', () => {
  it('renders structural guidance labels in Spanish without exposing private evidence', () => {
    const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={{ instagram: receipt }} />);
    expect(html).toContain('Orientación de subtítulos');
    expect(html).toContain('Subtítulo corto con pregunta');
    expect(html).not.toContain(receipt.captionSha256);
  });

  it('formats the persisted prior-example count through the selected locale', () => {
  const manyExamples = Array.from({ length: 12 }, (_, index) =>
    `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  );
  const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={{ instagram: {
    ...receipt,
    exemplarIds: manyExamples,
  } }} />);
  expect(html).toContain('Se proporcionaron 12 ejemplo(s) anterior(es).');
  });
});
