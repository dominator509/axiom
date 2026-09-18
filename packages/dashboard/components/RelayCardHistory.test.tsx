import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
});
