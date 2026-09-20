import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'de',
    setLocale: () => undefined,
    t: (key: string) => ({
      'caption.savedCaptions': 'Gespeicherte Ziel-Bildunterschriften',
      'caption.savedDescription': 'Diese Bildunterschriften sind zur Prüfung im Paket gespeichert.',
      'caption.fallback': 'Die optionale KI-Anreicherung war nicht verfügbar.',
      'caption.enriched': 'KI-angereicherte Bildunterschrift gespeichert.',
      'caption.notRequested': 'KI-Anreicherung wurde nicht angefordert.',
      'caption.statusUnavailable': 'Der Anreicherungsstatus ist für diesen Beleg nicht verfügbar.',
    }[key] ?? key),
  }),
}));
import GeneratedCaptionReceipt from './GeneratedCaptionReceipt';

describe('GeneratedCaptionReceipt locale coverage', () => {
  it('renders saved-caption review states in German', () => {
    const html = renderToStaticMarkup(<GeneratedCaptionReceipt
      captions={{ instagram: 'Saved caption' }}
      enrichment={{ instagram: 'enriched' }}
    />);
    expect(html).toContain('Gespeicherte Ziel-Bildunterschriften');
    expect(html).toContain('KI-angereicherte Bildunterschrift gespeichert.');
    expect(html).not.toContain('Saved destination captions');
  });
});
