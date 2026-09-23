import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatNumber } from '@axiom/core';

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  index: 0,
  keyCounter: 0,
  send: vi.fn(),
}));

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
vi.mock('@/lib/mutation', () => ({ mutationFetch: hooks.send, createIdempotencyKey: () => `affiliate-intent-${++hooks.keyCounter}` }));

import PlatformAffiliateManager, { formatAffiliateDate, referralPath } from './PlatformAffiliateManager';
import type { AffiliateHold, AffiliateProgramSnapshot } from '@/lib/api';

const partner = {
  id: 'partner-1', programId: 'program-1', displayName: 'Partner One', email: 'one@example.test', status: 'active',
  termsVersion: 'affiliate-v1', disclosureAcceptedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} as const;
const campaign = {
  id: 'campaign-1', programId: 'program-1', partnerId: 'partner-1', name: 'Launch', slug: 'launch', referralToken: 'ref-token', status: 'active', commissionBps: 2000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} as const;
const snapshot: AffiliateProgramSnapshot = {
  program: { id: 'program-1', slug: 'fanthynks', name: 'FanThynks Creator Referral', status: 'active', termsVersion: 'affiliate-v1', defaultCommissionBps: 2000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  billingWebhook: { configured: false, endpoint: '/api/v1/platform/affiliate-billing/webhook', signatureHeader: 'X-Axiom-Billing-Signature' },
  partners: [], campaigns: [], holds: [],
  summary: { partners: 0, campaigns: 0, attributionEvents: 0, conversions: 0, accruedCents: 0, reversedCents: 0, openHolds: 0 },
};

interface NodeProps {
  [key: string]: unknown;
  children?: unknown;
  name?: string;
  onChange?: (event: { target: { value?: string; checked?: boolean } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
}
interface Node { type: unknown; props: NodeProps; }
function find(value: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) { for (const item of value) { const result = find(item, predicate); if (result) return result; } return undefined; }
  const node = value as Node;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function render(current = snapshot) { hooks.index = 0; return PlatformAffiliateManager({ initial: current }); }
function textContent(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (typeof value === 'object') return textContent((value as Node).props?.children);
  return '';
}
function namedInput(tree: unknown, name: string): Node {
  const node = find(tree, value => value.type === 'input' && value.props.name === name);
  expect(node).toBeDefined();
  return node!;
}
function namedSelect(tree: unknown, name: string): Node {
  const node = find(tree, value => value.type === 'select' && value.props.name === name);
  expect(node).toBeDefined();
  return node!;
}

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.keyCounter = 0;
  hooks.send.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it('creates a partner through the owner API with disclosure and an idempotency key', async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValue(Response.json({ data: snapshot }));
  hooks.send.mockResolvedValue(Response.json({ data: { ...partner, status: 'invited' } }, { status: 201 }));
  let tree = render();
  namedInput(tree, 'displayName').props.onChange!({ target: { value: 'Partner One' } });
  tree = render();
  namedInput(tree, 'email').props.onChange!({ target: { value: 'one@example.test' } });
  tree = render();
  namedInput(tree, 'disclosureAccepted').props.onChange!({ target: { checked: true } });
  tree = render();
  const form = find(tree, node => node.type === 'form' && node.props['aria-label'] === 'Create partner');
  expect(form).toBeDefined();
  form!.props.onSubmit!({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledOnce());
  expect(hooks.send.mock.calls[0][0]).toBe('/api/v1/platform/affiliate/partners');
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toMatchObject({ displayName: 'Partner One', email: 'one@example.test', termsVersion: 'affiliate-v1', disclosureAccepted: true, status: 'invited' });
  expect(hooks.send.mock.calls[0][2]).toMatchObject({ idempotencyKey: 'affiliate-intent-1', retries: 0 });
});

it('retries an uncertain partner creation with the exact original body and idempotency key', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ data: snapshot }));
  hooks.send
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(Response.json({ data: { ...partner, status: 'invited' } }, { status: 201 }));

  let tree = render();
  namedInput(tree, 'displayName').props.onChange!({ target: { value: 'Partner One' } });
  tree = render();
  namedInput(tree, 'email').props.onChange!({ target: { value: 'one@example.test' } });
  tree = render();
  const form = find(tree, node => node.type === 'form' && node.props['aria-label'] === 'Create partner');
  form!.props.onSubmit!({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledOnce());

  await vi.waitFor(() => {
    tree = render();
    const section = find(tree, node => node.type === 'section' && node.props.role === 'alert');
    const button = find(section, node => node.type === 'button');
    expect(button).toBeDefined();
    expect(button!.props.disabled).toBe(false);
  });
  const section = find(tree, node => node.type === 'section' && node.props.role === 'alert');
  const retry = find(section, node => node.type === 'button');
  expect(retry).toBeDefined();
  (retry!.props.onClick as () => void)();
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledTimes(2));

  expect(hooks.send.mock.calls[1][0]).toBe(hooks.send.mock.calls[0][0]);
  expect(hooks.send.mock.calls[1][1].body).toBe(hooks.send.mock.calls[0][1].body);
  expect(hooks.send.mock.calls[1][2]).toEqual(hooks.send.mock.calls[0][2]);
  await vi.waitFor(() => expect(textContent(render())).toContain('Partner created'));
});

it('creates campaigns only from disclosed partners and renders report and payout controls', async () => {
  const activeSnapshot: AffiliateProgramSnapshot = { ...snapshot, partners: [partner], campaigns: [campaign], summary: { ...snapshot.summary, partners: 1, campaigns: 1 } };
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValue(Response.json({ data: activeSnapshot }));
  hooks.send.mockResolvedValue(Response.json({ data: campaign }, { status: 201 }));
  let tree = render(activeSnapshot);
  namedInput(tree, 'campaignName').props.onChange!({ target: { value: 'Creator launch' } });
  tree = render(activeSnapshot);
  namedInput(tree, 'campaignSlug').props.onChange!({ target: { value: 'creator-launch' } });
  tree = render(activeSnapshot);
  namedInput(tree, 'commissionBps').props.onChange!({ target: { value: '2500' } });
  tree = render(activeSnapshot);
  namedSelect(tree, 'campaignStatus').props.onChange!({ target: { value: 'draft' } });
  tree = render(activeSnapshot);
  const form = find(tree, node => node.type === 'form' && node.props['aria-label'] === 'Create a campaign');
  expect(form).toBeDefined();
  form!.props.onSubmit!({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledOnce());
  expect(hooks.send.mock.calls[0][0]).toBe('/api/v1/platform/affiliate/campaigns');
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ partnerId: 'partner-1', name: 'Creator launch', slug: 'creator-launch', status: 'draft', commissionBps: 2500 });
  const payout = find(tree, node => node.type === 'a' && String(node.props.href).includes('/payouts/export?partnerId=partner-1'));
  expect(payout).toBeDefined();
  expect(find(tree, node => node.type === 'button' && node.props.children === 'View report')).toBeDefined();
});

it('renders a public referral path and copies an origin-qualified link', async () => {
  const activeSnapshot: AffiliateProgramSnapshot = { ...snapshot, partners: [partner], campaigns: [campaign], summary: { ...snapshot.summary, partners: 1, campaigns: 1 } };
  vi.stubGlobal('window', { location: { origin: 'https://fanthynks.test' } });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });

  const tree = render(activeSnapshot);
  const link = find(tree, node => node.type === 'a' && node.props.href === referralPath(campaign.referralToken));
  expect(link).toBeDefined();
  expect(link!.props.target).toBe('_blank');
  const copy = find(tree, node => node.type === 'button' && textContent(node.props.children) === 'Copy referral link');
  expect(copy).toBeDefined();
  (copy!.props.onClick as () => void)();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://fanthynks.test/affiliate/r/ref-token'));
});

it('formats open hold dates in the selected locale with an explicit UTC zone', () => {
  const hold: AffiliateHold = {
    id: 'hold-1', programId: 'program-1', partnerId: 'partner-1', commissionId: null,
    reason: 'fraud_suspected', state: 'open', resolvedByUserId: null,
    createdAt: '2026-01-01T00:30:00.000Z', resolvedAt: null,
  };
  const previousTz = process.env.TZ;
  process.env.TZ = 'Pacific/Honolulu';
  try {
    const tree = render({ ...snapshot, partners: [partner], holds: [hold], summary: { ...snapshot.summary, openHolds: 1 } });
    const rendered = textContent(tree);
    expect(rendered).toContain('Jan 1, 2026');
    expect(rendered).not.toContain('Dec 31, 2025');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

it('renders persisted hold reasons as user-facing labels instead of raw codes', () => {
  const hold: AffiliateHold = {
    id: 'hold-2', programId: 'program-1', partnerId: 'partner-1', commissionId: null,
    reason: 'fraud_suspected', state: 'open', resolvedByUserId: null,
    createdAt: '2026-01-01T00:30:00.000Z', resolvedAt: null,
  };
  const rendered = textContent(render({ ...snapshot, partners: [partner], holds: [hold], summary: { ...snapshot.summary, openHolds: 1 } }));
  expect(rendered).toContain('Suspected fraud');
  expect(rendered).not.toContain('fraud_suspected');
  expect(formatAffiliateDate(hold.createdAt, 'en')).toContain('2026');
});

it('formats affiliate summary counts through the selected locale', () => {
  const activeSnapshot: AffiliateProgramSnapshot = {
    ...snapshot,
    partners: [partner],
    summary: {
      ...snapshot.summary,
      partners: 1234,
      campaigns: 2345,
      attributionEvents: 3456,
      openHolds: 4,
    },
  };
  const rendered = textContent(render(activeSnapshot));
  expect(rendered).toContain(formatNumber(1234, 'en'));
  expect(rendered).toContain(formatNumber(2345, 'en'));
  expect(rendered).toContain(formatNumber(3456, 'en'));
});
