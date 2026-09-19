import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  index: 0,
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
}));
vi.mock('@/lib/mutation', () => ({ mutationFetch: hooks.send, createIdempotencyKey: () => 'affiliate-intent' }));

import PlatformAffiliateManager from './PlatformAffiliateManager';
import type { AffiliateProgramSnapshot } from '@/lib/api';

const partner = {
  id: 'partner-1', programId: 'program-1', displayName: 'Partner One', email: 'one@example.test', status: 'active',
  termsVersion: 'affiliate-v1', disclosureAcceptedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} as const;
const campaign = {
  id: 'campaign-1', programId: 'program-1', partnerId: 'partner-1', name: 'Launch', slug: 'launch', referralToken: 'ref-token', status: 'active', commissionBps: 2000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} as const;
const snapshot: AffiliateProgramSnapshot = {
  program: { id: 'program-1', slug: 'fanthynks', name: 'FanThynks Creator Referral', status: 'active', termsVersion: 'affiliate-v1', defaultCommissionBps: 2000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
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
  const form = find(tree, node => node.type === 'form' && node.props['aria-label'] === 'Create affiliate partner');
  expect(form).toBeDefined();
  form!.props.onSubmit!({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledOnce());
  expect(hooks.send.mock.calls[0][0]).toBe('/api/v1/platform/affiliate/partners');
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toMatchObject({ displayName: 'Partner One', email: 'one@example.test', termsVersion: 'affiliate-v1', disclosureAccepted: true, status: 'invited' });
  expect(hooks.send.mock.calls[0][2]).toMatchObject({ idempotencyKey: 'affiliate-intent', retries: 0 });
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
  const form = find(tree, node => node.type === 'form' && node.props['aria-label'] === 'Create affiliate campaign');
  expect(form).toBeDefined();
  form!.props.onSubmit!({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(hooks.send).toHaveBeenCalledOnce());
  expect(hooks.send.mock.calls[0][0]).toBe('/api/v1/platform/affiliate/campaigns');
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ partnerId: 'partner-1', name: 'Creator launch', slug: 'creator-launch', status: 'draft', commissionBps: 2500 });
  const payout = find(tree, node => node.type === 'a' && String(node.props.href).includes('/payouts/export?partnerId=partner-1'));
  expect(payout).toBeDefined();
  expect(find(tree, node => node.type === 'button' && node.props.children === 'View report')).toBeDefined();
});
