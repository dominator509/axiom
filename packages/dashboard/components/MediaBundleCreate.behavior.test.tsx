import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, send: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    return hooks.slots[index] ??= { current: initial };
  },
}));
vi.mock('@/lib/mutation', () => ({ createIdempotencyKey: () => 'intent-key', mutationFetch: hooks.send }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'review.writeCaption': 'Write a caption before creating a review bundle.',
      'review.invalidSchedule': 'Choose a valid schedule.',
      'review.bundleCreationUnconfirmed': 'Bundle creation was not confirmed.',
      'review.reviewBundleSaved': 'Review bundle saved. A fresh media and caption scan is queued. Nothing was published.',
      'review.outcomeUnconfirmed': 'Outcome unconfirmed. Check the same request to avoid creating another bundle.',
      'review.transcodeMp4': 'To prepare this video for approval, transcode it to MP4 first.',
      'review.createPostFromMedia': 'Create post from this media',
      'review.bundleDescription': 'Choose a destination and write a caption. This creates a new review bundle, without generating media or publishing.',
      'review.destination': 'Destination',
      'review.caption': 'Caption',
      'review.requestedPostingTime': 'Requested posting time (optional, your local time)',
      'review.scheduleRequestHelp': 'This is a request for the approver, not a scheduled publication. Leave blank to let them choose. During a repeated daylight-saving hour, the first occurrence is used.',
      'review.savingReviewBundle': 'Saving review bundle…',
      'review.checkSameRequest': 'Check same request',
      'review.createReviewBundle': 'Create review bundle',
      'review.openApprovals': 'Open approvals',
    }[key] ?? key),
  }),
}));
import MediaBundleCreate from './MediaBundleCreate';
function render() { hooks.index = 0; return MediaBundleCreate({ modelId: 'model', assetId: 'asset', mimeType: 'image/jpeg' }); }
function find(node: any, type: string): any {
  if (!node || typeof node !== 'object') return;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; }
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.send.mockReset(); });
it('keeps the exact user intent across an uncertain response and prevents concurrent dispatch', async () => {
  find(render(), 'textarea').props.onChange({ target: { value: 'A ceramic vase' } });
  let reject!: (error: Error) => void;
  hooks.send.mockReturnValueOnce(new Promise((_resolve, rejectCall) => { reject = rejectCall; }));
  const button = find(render(), 'button');
  button.props.onClick(); button.props.onClick();
  expect(hooks.send).toHaveBeenCalledTimes(1);
  reject(new Error('Lost response'));
  await vi.waitFor(() => expect(find(render(), 'button').props.children).toBe('Check same request'));
  expect(find(render(), 'fieldset').props.disabled).toBe(true);
  hooks.send.mockResolvedValueOnce(Response.json({ data: { id: '11111111-1111-4111-8111-111111111111' } }));
  find(render(), 'button').props.onClick();
  await vi.waitFor(() => expect(find(render(), 'button')).toBeUndefined());
  expect(hooks.send).toHaveBeenCalledTimes(2);
  expect(hooks.send.mock.calls[1]).toEqual(hooks.send.mock.calls[0]);
  expect(JSON.parse(hooks.send.mock.calls[0][1].body)).toEqual({ modelId: 'model', assetId: 'asset', captions: { instagram: 'A ceramic vase' }, hashtags: [] });
});
it('stores a requested local schedule in UTC and confirms the saved schedule receipt', async () => {
  find(render(), 'textarea').props.onChange({ target: { value: 'A ceramic vase' } });
  find(render(), 'input').props.onChange({ target: { value: '2099-06-15T12:30' } });
  hooks.send.mockImplementationOnce(async (_path, init) => {
    const request = JSON.parse(init.body).scheduleRequest;
    return Response.json({ data: { id: '11111111-1111-4111-8111-111111111111', publishIntent: { action: 'schedule', ...request } } });
  });
  find(render(), 'button').props.onClick();
  await vi.waitFor(() => expect(find(render(), 'button')).toBeUndefined());
  expect(JSON.parse(hooks.send.mock.calls[0][1].body).scheduleRequest).toEqual({ platform: 'instagram', scheduledAt: new Date('2099-06-15T12:30').toISOString() });
});
it('rejects a past requested time before submitting', () => {
  find(render(), 'textarea').props.onChange({ target: { value: 'A ceramic vase' } });
  find(render(), 'input').props.onChange({ target: { value: '2020-01-01T12:30' } });
  find(render(), 'button').props.onClick();
  expect(hooks.send).not.toHaveBeenCalled();
});
