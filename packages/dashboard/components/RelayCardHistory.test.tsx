import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CATALOGS, LocaleCatalog, MESSAGE_KEYS, SUPPORTED_LOCALES, formatDate, formatNumber } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import RelayCardHistory from './RelayCardHistory';

const card = {
  id: 'card-1',
  bundleId: 'bundle-1',
  channel: 'telegram',
  state: 'sent',
  title: 'Approval ready',
  description: 'Review this bundle',
  icon: 'check',
  enabled: true,
  priority: 1,
  createdAt: '2026-01-02T03:04:05.000Z',
};

describe('RelayCardHistory', () => {
  it('renders safe card context and an approval deep link', () => {
    const html = renderToStaticMarkup(<RelayCardHistory modelId="model-1" cards={[card]} nextCursor="next" />);
    expect(html).toContain('Approval ready');
    expect(html).toContain('telegram');
    expect(html).toContain('/models/model-1/approvals');
    expect(html).toContain('Older Relay cards');
  });

  it('explains an empty history without implying external delivery', () => {
    const html = renderToStaticMarkup(<RelayCardHistory modelId="model-1" cards={[]} nextCursor={null} />);
    expect(html).toContain('No Relay cards have been recorded');
    expect(html).not.toContain('delivered');
  });

  it('renders localized labels under a non-English locale', () => {
    const catalog = new LocaleCatalog(CATALOGS);
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="ja">
        <RelayCardHistory modelId="model-1" cards={[{ ...card, priority: 1234 }]} nextCursor="next" />
      </LocaleProvider>,
    );
    expect(html).toContain(catalog.t('ja', 'relay.card.openApproval'));
    expect(html).toContain(catalog.t('ja', 'relay.card.older'));
    expect(html).toContain(formatDate(new Date(card.createdAt), 'ja', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }));
    expect(html).toContain(formatNumber(1234, 'ja'));
    expect(html).not.toContain('2026-01-02T03:04:05.000Z');
    // Creator-authored card content is never translated.
    expect(html).toContain('Approval ready');
    expect(html).toContain('telegram');
  });

  it('exposes explicit operator reconciliation only for unresolved cards', () => {
    const html = renderToStaticMarkup(<RelayCardHistory modelId="model-1" cards={[{ ...card, state: 'pending' }]} nextCursor={null} canReconcile />);
    expect(html).toContain('I confirmed delivery');
    expect(html).toContain('I confirmed it was not delivered');
    expect(html).toContain('does not contact or retry the provider');
    const readOnly = renderToStaticMarkup(<RelayCardHistory modelId="model-1" cards={[card]} nextCursor={null} canReconcile />);
    expect(readOnly).not.toContain('I confirmed delivery');
  });

  it('covers every digest/relay key in all six catalogs without English fallback', () => {
    const keys = MESSAGE_KEYS.filter(k => k.startsWith('digest.') || k.startsWith('relay.'));
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) {
        expect(typeof CATALOGS[locale][key], `${locale}.${key}`).toBe('string');
        expect(CATALOGS[locale][key].length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
    for (const locale of SUPPORTED_LOCALES.filter(l => l !== 'en')) {
      const identical = keys.filter(k => CATALOGS[locale][k] === CATALOGS.en[k]);
      expect(identical, `untranslated in ${locale}: ${identical.join(', ')}`).toEqual([]);
    }
  });
});
