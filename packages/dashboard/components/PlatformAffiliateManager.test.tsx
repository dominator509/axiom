import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatNumber } from '@axiom/core';

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
  const link = find(tree, node => nodu÷Nm¢G§²ÚîÆ­yÒw&VvVæW&FRrÂw&Wf—6RrÂw&V¦V7BrÂv†öÆBuÓ°Ð Ð¢&WGW&â°Ð¢¶–æC¢v'VæFÆRrÀÐ¢6&D–C¢'VæFÆRæ6&D–BÀÐ¢'VæFÆT–C¢'VæFÆRæ–BÀÐ¢ÖVF–&Wf–Ws¢'VæFÆRæÖVF–W&Ç5³ÒóòrrÀÐ¢6F–öã¢'VæFÆRæ6F–öâÀÐ¢6F–öåf&–çG3¢'VæFÆRæ6F–öåf&–çG2ÀÐ¢†6‡Fu6WG3¢'VæFÆRæ†6‡Fu6WG2ÀÐ¢fW&F–7G2ÀÐ¢F&vWEÆFf÷&×3¢'VæFÆRçF&vWEÆFf÷&×2ÀÐ¢&–6S¢'VæFÆRç&–6RÀÐ¢66†VGVÆTC¢'VæFÆRç66†VGVÆTBÀÐ¢7F–öç2ÀÐ¢6öÖÖæEFö¶Vç3¢'VæFÆRæ6öÖÖæEFö¶Vç2ÀÐ¢F–ÖW7F×¢FFRææ÷r‚’ÀÐ¢f÷&ÖC¢v‡FÖÂrÀÐ¢Ó°Ð¢ÐÐ Ð¢&VæFW$–ç6–v‡D6&B†–ç6–v‡C¢–ç6–v‡D6öçFVçB“¢&VÆ”6&B°Ð¢&WGW&â°Ð¢¶–æC¢v–ç6–v‡BrÀÐ¢6&D–C¢–ç6–v‡Bæ6&D–BÀÐ¢òò6†ææVÂFFW'26†&RF†R†—7F÷&–6Â&VÆ”6&BVçfVÆ÷Rââ–ç6–v‡@Ð¢òò†2æò6öçFVçB'VæFÆR&VÆF–öç6†—²F†RV×G’G&ç7÷'Bf–VÆB—0Ð¢òò–çFVçF–öæÆÇ’æWfW"W6VBf÷"FF&6RÆöö·W2÷"6öÖÖæB&÷WF–æràÐ¢'VæFÆT–C¢rrÀÐ¢ÖVF–&Wf–Ws¢rrÀÐ¢6F–öã¢–ç6–v‡BæFW67&—F–öâÀÐ¢6F–öåf&–çG3¢·ÒÀÐ¢†6‡Fu6WG3¢·ÒÀÐ¢fW&F–7G3¢µÒÀÐ¢F&vWEÆFf÷&×3¢µÒÀÐ¢7F–öç3¢µÒÀÐ¢F–ÖW7F×¢FFRææ÷r‚’ÀÐ¢f÷&ÖC¢v‡FÖÂrÀÐ¢–ç6–v‡C¢°Ð¢F—FÆS¢–ç6–v‡BçF—FÆRç6Æ–6RƒÂc’ÀÐ¢FW67&—F–öã¢–ç6–v‡BæFW67&—F–öâç6Æ–6RƒÂ#’ÀÐ¢âââ†–ç6–v‡Bæ–6öâò²–6öã¢–ç6–v‡Bæ–6öâç6Æ–6RƒÂb’Ò¢·Ò’ÀÐ¢w&÷W3¢–ç6–v‡Bæw&÷W2ç6Æ–6RƒÂ’æÖ†w&÷WÓâ‡°Ð¢ÆFf÷&Ó¢w&÷WçÆFf÷&Òç6Æ–6RƒÂC‚’ÀÐ¢ÆV&æ–æt&Ó¢w&÷WæÆV&æ–æt&Òç6Æ–6RƒÂ“b’ÀÐ¢ÆV&æ–æt6öçFW‡C¢w&÷WæÆV&æ–æt6öçFW‡Bç6Æ–6RƒÂ“b’ÀÐ¢6×ÆU6—¦S¢ÖF‚æÖ‚ƒÂÖF‚çG'Væ2†w&÷Wç6×ÆU6—¦R’’ÀÐ¢ÖVå66÷&S¢çVÖ&W"æ—4f–æ—FR†w&÷WæÖVå66÷&R’òw&÷WæÖVå66÷&R¢ÀÐ¢âââ†w&÷WçV&Æ—6†VD†÷W%WF2ÓÒçVÆÂò·Ò¢²V&Æ—6†VD†÷W%WF3¢w&÷WçV&Æ—6†VD†÷W%WF2Ò’ÀÐ¢Ò’’ÀÐ¢ÒÀÐ¢Ó°Ð¢ÐÐ Ð¢Fô‡FÖÂ†6&C¢&VÆ”6&B“¢7G&–ær°Ð¢–b†6&Bæ¶–æBÓÓÒv–ç6–v‡Br’&WGW&âF†—2çFô–ç6–v‡D‡FÖÂ†6&B“°Ð¢6öç7BfW&F–7E&÷w2Ò6&BçfW&F–7G0Ð¢æÖ€Ð¢‡b’ÓàÐ¢Æ#âG·bçÆFf÷&×Ó£Âö#âG·bç76VBò~)ÈR52r¢~)ØÂd”ÂwÒ‚G²‡bç66÷&R¢’çFôf—†VBƒ—ÒR–ÀÐ¢Ð¢æ¦ö–â‚uÆâr“°Ð¢6öç7B†6‡Fu&÷w2Òö&¦V7BæVçG&–W2†6&Bæ†6‡Fu6WG2Ð¢æÖ‚…·ÂFw5Ò’ÓâÆ#âG·Ó£Âö#âG·Fw2ç6Æ–6RƒÂR’æ¦ö–â‚rr—ÖÐ¢æ¦ö–â‚uÆâr“°Ð¢&WGW&â°Ð¢Æ#ï	ù:b'VæFÆS¢G¶6&Bæ'VæFÆT–GÓÂö#æÀÐ¢rrÀÐ¢6&BæÖVF–&Wf–WròÆ#å&Wf–Ws£Âö#âG¶6&BæÖVF–&Wf–WwÖ¢rrÀÐ¢Æ#ä6F–öã£Âö#âG¶6&Bæ6F–öâç6Æ–6RƒÂ#—ÖÀÐ¢rrÀÐ¢Æ#åFõ2fW&F–7G3£Âö#æÀÐ¢fW&F–7E&÷w2ÀÐ¢rrÀÐ¢Æ#ä†6‡Fw3£Âö#æÀÐ¢†6‡Fu&÷w2ÀÐ¢rrÀÐ¢6&Bç&–6RòÆ#å&–6S£Âö#âBG¶6&Bç&–6WÖ¢rrÀÐ¢6&Bç66†VGVÆTBòÆ#å66†VGVÆVC£Âö#âG¶6&Bç66†VGVÆTGÖ¢rrÀÐ¢ÐÐ¢æf–ÇFW"„&ööÆVâÐ¢æ¦ö–â‚uÆâr“°Ð¢ÐÐ Ð¢FôVÖ&VB†6&C¢&VÆ”6&B“¢&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ°Ð¢–b†6&Bæ¶–æBÓÓÒv–ç6–v‡Br’&WGW&âF†—2çFô–ç6–v‡DVÖ&VB†6&B“°Ð¢&WGW&â°Ð¢F—FÆS¢	ù:b'VæFÆS¢G¶6&Bæ'VæFÆT–Bç6Æ–6RƒÂ‚—ÖÀÐ¢FW67&—F–öã¢6&Bæ6F–öâç6Æ–6RƒÂC’ÀÐ¢6öÆ÷#¢6&BçfW&F–7G2æWfW'’‚‡b’Óâbç76VB’òƒfc¢†fcÀÐ¢âââ†6&BæÖVF–&Wf–Wrò²–ÖvS¢²W&Ã¢6&BæÖVF–&Wf–WrÒÒ¢·Ò’ÀÐ¢f–VÆG3¢°Ð¢°Ð¢æÖS¢uFõ2fW&F–7G2rÀÐ¢fÇVS¢6&BçfW&F–7G0Ð¢æÖ‚‡b’ÓâG·bçÆFf÷&×Ó¢G·bç76VBò~)ÈRr¢~)ØÂwÒ‚G²‡bç66÷&R¢’çFôf—†VBƒ—ÒR–Ð¢æ¦ö–â‚uÆâr’ÀÐ¢–æÆ–æS¢fÇ6RÀÐ¢ÒÀÐ¢°Ð¢æÖS¢uF&vWBÆFf÷&×2rÀÐ¢fÇVS¢6&BçF&vWEÆFf÷&×2æ¦ö–â‚rÂr’ÀÐ¢–æÆ–æS¢G'VRÀÐ¢ÒÀÐ¢âââ†6&Bç&–6Rò·²æÖS¢u&–6RrÂfÇVS¢BG¶6&Bç&–6WÖÂ–æÆ–æS¢G'VRÕÒ¢µÒ’ÀÐ¢âââ†6&Bç66†VGVÆTBò·²æÖS¢u66†VGVÆVBrÂfÇVS¢6&Bç66†VGVÆTBÂ–æÆ–æS¢G'VRÕÒ¢µÒ’ÀÐ¢ÒÀÐ¢F–ÖW7F×¢æWrFFR†6&BçF–ÖW7F×’çFô•4õ7G&–ær‚’ÀÐ¢Ó°Ð¢ÐÐ Ð¢FõFW‡B†6&C¢&VÆ”6&B“¢7G&–ær°Ð¢–b†6&Bæ¶–æBÓÓÒv–ç6–v‡Br’&WGW&âF†—2çFô–ç6–v‡EFW‡B†6&B“°Ð¢6öç7BÆ–æW3¢7G&–æuµÒÒ°Ð¢	ù:b'VæFÆS¢G¶6&Bæ'VæFÆT–GÖÀÐ¢âââ†6&BæÖVF–&Wf–Wrò¶&Wf–Ws¢G¶6&BæÖVF–&Wf–WwÖÒ¢µÒ’ÀÐ¢6F–öã¢G¶6&Bæ6F–öâç6Æ–6RƒÂ#—ÖÀÐ¢rrÀÐ¢uFõ2fW&F–7G3¢rÀÐ¢ââæ6&BçfW&F–7G2æÖ€Ð¢‡b’ÓâG·bçÆFf÷&×Ó¢G·bç76VBòu52r¢td”ÂwÒ‚G²‡bç66÷&R¢’çFôf—†VBƒ—ÒR–ÀÐ¢’ÀÐ¢rrÀÐ¢6&Bæ7F–öç2æWfW'’‚†7F–öâ’Óâ&ööÆVâ†6&Bæ6öÖÖæEFö¶Vç3òå¶7F–öåÒ’Ð¢òt7F–öç2‡&WÇ’v—F‚F†R7F–öâæB—G26–væVBFö¶Vâ“¢pÐ¢¢t7F–öç2‡&WÇ’v—F‚¶W—v÷&B“¢rÀÐ¢ââæ6&Bæ7F–öç2æÖ‚†7F–öâ’ÓâG¶7F–öä¶W—v÷&B†7F–öâÂ6&Bæ6öÖÖæEFö¶Vç3òå¶7F–öåÒ—Ö’ÀÐ¢Ó°Ð¢&WGW&âÆ–æW2æ¦ö–â‚uÆâr“°Ð¢ÐÐ Ð¢&—fFRFô–ç6–v‡D‡FÖÂ†6&C¢&VÆ”6&B“¢7G&–ær°Ð¢6öç7B–ç6–v‡BÒ6&Bæ–ç6–v‡C°Ð¢–b‚–ç6–v‡B’F‡&÷ræWrW'&÷"‚v–ç6–v‡B&VÆ’6&BÖ—76–ær–ç6–v‡B–ÆöBr“°Ð¢6öç7Bw&÷W2Ò–ç6–v‡Bæw&÷W2æÖ†w&÷WÓâ°Ð¢6öç7B†÷W"Òw&÷WçV&Æ—6†VD†÷W%WF2ÓÒçVÆÂòrr¢+rG¶w&÷WçV&Æ—6†VD†÷W%WF7Ó£UD6°Ð¢&WGW&âÆ#âG¶W66T‡FÖÂ†w&÷WçÆFf÷&Ò—ÓÂö#â+rG¶W66T‡FÖÂ†w&÷WæÆV&æ–æt&Ò—Ò+rãÒG¶w&÷Wç6×ÆU6—¦WÒ+rÖVâG¶w&÷WæÖVå66÷&RçFôf—†VBƒ"—ÒG¶†÷W'Ö°Ð¢Ò“°Ð¢&WGW&â°Ð¢Æ#âG¶W66T‡FÖÂ†–ç6–v‡Bæ–6öâóò	ù8‚r—ÒG¶W66T‡FÖÂ†–ç6–v‡BçF—FÆR—ÓÂö#æÀÐ¢rrÀÐ¢W66T‡FÖÂ†–ç6–v‡BæFW67&—F–öâ’ÀÐ¢w&÷W2æÆVæwF‚âòrr¢VæFVf–æVBÀÐ¢w&÷W2æÆVæwF‚âòsÆ#äWf–FVæ6S£Âö#âr¢VæFVf–æVBÀÐ¢ââæw&÷W2ÀÐ¢Òæf–ÇFW"‚‡fÇVR“¢fÇVR—27G&–ærÓâfÇVRÓÒVæFVf–æVB’æ¦ö–â‚uÆâr“°Ð¢ÐÐ Ð¢&—fFRFô–ç6–v‡DVÖ&VB†6&C¢&VÆ”6&B“¢&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ°Ð¢6öç7B–ç6–v‡BÒ6&Bæ–ç6–v‡C°Ð¢–b‚–ç6–v‡B’F‡&÷ræWrW'&÷"‚v–ç6–v‡B&VÆ’6&BÖ—76–ær–ç6–v‡B–ÆöBr“°Ð¢&WGW&â°Ð¢F—FÆS¢G¶–ç6–v‡Bæ–6öâóò	ù8‚wÒG¶–ç6–v‡BçF—FÆWÖç6Æ–6RƒÂ#Sb’ÀÐ¢FW67&—F–öã¢–ç6–v‡BæFW67&—F–öâç6Æ–6RƒÂC’ÀÐ¢6öÆ÷#¢ƒFcCfSRÀÐ¢f–VÆG3¢–ç6–v‡Bæw&÷W2ç6Æ–6RƒÂ’æÖ†w&÷WÓâ‡°Ð¢æÖS¢w&÷WçÆFf÷&ÒÀÐ¢fÇVS¢G¶w&÷WæÆV&æ–æt&×Ò+rãÒG¶w&÷Wç6×ÆU6—¦WÒ+rÖVâG¶w&÷WæÖVå66÷&RçFôf—†VBƒ"—ÒG¶w&÷WçV&Æ—6†VD†÷W%WF2ÓÒçVÆÂòrr¢+rG¶w&÷WçV&Æ—6†VD†÷W%WF7Ó£UD6ÖÀÐ¢–æÆ–æS¢fÇ6RÀÐ¢Ò’’ÀÐ¢F–ÖW7F×¢æWrFFR†6&BçF–ÖW7F×’çFô•4õ7G&–ær‚’ÀÐ¢Ó°Ð¢ÐÐ Ð¢&—fFRFô–ç6–v‡EFW‡B†6&C¢&VÆ”6&B“¢7G&–ær°Ð¢6öç7B–ç6–v‡BÒ6&Bæ–ç6–v‡C°Ð¢–b‚–ç6–v‡B’F‡&÷ræWrW'&÷"‚v–ç6–v‡B&VÆ’6&BÖ—76–ær–ç6–v‡B–ÆöBr“°Ð¢&WGW&â°Ð¢G¶–ç6–v‡Bæ–6öâóò	ù8‚wÒG¶–ç6–v‡BçF—FÆWÖÀÐ¢rrÀÐ¢–ç6–v‡BæFW67&—F–öâÀÐ¢ââæ–ç6–v‡Bæw&÷W2æÖ†w&÷WÓàÐ¢G¶w&÷WçÆFf÷&×Ò+rG¶w&÷WæÆV&æ–æt&×Ò+rãÒG¶w&÷Wç6×ÆU6—¦WÒ+rÖVâG¶w&÷WæÖVå66÷&RçFôf—†VBƒ"—ÒG¶w&÷WçV&Æ—6†VD†÷W%WF2ÓÒçVÆÂòrr¢+rG¶w&÷WçV&Æ—6†VD†÷W%WF7Ó£UD6ÖÀÐ¢’ÀÐ¢Òæ¦ö–â‚uÆâr“°Ð¢ÐÐ§ÐÐ Ð¦gVæ7F–öâW66T‡FÖÂ‡fÇVS¢7G&–ær“¢7G&–ær°Ð¢&WGW&âfÇVRç&WÆ6R‚õ²cÃâ%ÒörÂ6†&7FW"Óâ‡°¢rbs¢rf×²rÀÐ¢sÂs¢rfÇC²rÀÐ¢sâs¢rfwC²rÀÐ¢r"s¢rgV÷C²rÀÐ¢Õ¶6†&7FW%Òóò6†&7FW"’“°Ð§ÐÐ Ð¦gVæ7F–öâ7F–öä¶W—v÷&B†7F–öã¢6&D7F–öâÂFö¶Vãó¢7G&–ær“¢7G&–ær°Ð¢7v—F6‚†7F–öâ’°Ð¢66RvVF—Eö6F–öâs Ð¢&WGW&âFö¶VâòVF—BG·Fö¶VçÒÆæWr6F–öãæ¢vVF—BÆæWr6F–öãâs°Ð¢66Rw&W66†VGVÆRs Ð¢&WGW&âFö¶VàÐ¢ò66†VGVÆRG·Fö¶VçÒÆgWGW&R•4òÓƒcF–ÖW7F×æ Ð¢¢w66†VGVÆRÆgWGW&R•4òÓƒcF–ÖW7F×âs°Ð¢FVfVÇC Ð¢&WGW&âFö¶VâòG¶7F–öçÒG·Fö¶VçÖ¢7F–öã°Ð¢ÐÐ§ÐÐ