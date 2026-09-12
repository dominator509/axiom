import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ApproveButtons from './ApproveButtons';
import type { SocialConnection } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function connection(id: string, platform = 'threads', status = 'connected'): SocialConnection {
  return {
    id,
    platform,
    status,
    modelId: 'model',
    displayName: id,
    capabilities: [],
    connectedAt: '2026-01-01T00:00:00Z',
  };
}

function render(platforms: string[], connections: SocialConnection[]) {
  return renderToStaticMarkup(
    createElement(ApproveButtons, {
      bundleId: 'bundle',
      tosBlocked: false,
      platforms,
      connections,
    }),
  );
}

function approveButton(html: string) {
  const button = html.match(/<button[^>]*>Approve<\/button>/)?.[0];
  expect(button).toBeDefined();
  return button!;
}

describe('approval destination selection', () => {
  it('selects the actual bundle destination rather than assuming Instagram', () => {
    const html = render(['threads'], [connection('threads-account')]);
    expect(html).toContain('threads account');
    expect(html).not.toContain('instagram');
    expect(html).not.toContain('tiktok');
    expect(html).toContain('value="threads-account" selected=""');
    expect(approveButton(html)).not.toContain('disabled');
  });

  it('requires explicit selection when multiple accounts match', () => {
    const html = render(['threads'], [connection('first'), connection('second')]);
    expect(html).toContain('value="" selected=""');
    expect(html).toContain('value="first"');
    expect(html).toContain('value="second"');
    expect(approveButton(html)).toContain('disabled');
  });

  it('ignores disconnected accounts when choosing the single active account', () => {
    const html = render(
      ['threads'],
      [connection('old', 'threads', 'disconnected'), connection('active')],
    );
    expect(html).not.toContain('value="old"');
    expect(html).toContain('value="active" selected=""');
    expect(approveButton(html)).not.toContain('disabled');
  });

  it.each([{ platforms: [] }, { platforms: ['unknown-provider'] }])(
    'disables approval without a supported destination: %j',
    ({ platforms }) => {
      const html = render(platforms, [connection('account')]);
      expect(html).toContain('No supported publishing destinations');
      expect(approveButton(html)).toContain('disabled');
    },
  );

  it('requires a connected account for the bundle destination', () => {
    const html = render(['threads'], [connection('instagram-account', 'instagram')]);
    expect(html).toContain('Connect or select an account for: threads');
    expect(approveButton(html)).toContain('disabled');
  });
});
