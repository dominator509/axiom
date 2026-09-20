import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CaptionGuidance from './CaptionGuidance';
const id = '11111111-1111-4111-8111-111111111111';
const caption = 'Original caption?';
const receipt = { version: 'caption-guidance-v1' as const, selectedArm: 'short:question',
  context: 'learn-v1:scheduled-utc-3', exemplarIds: [id], captionSha256: createHash('sha256').update(caption).digest('hex') };
it('explains matched guidance without exposing exemplar identifiers or claiming performance', () => {
  const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={{ instagram: receipt }} />);
  expect(html).toContain('<summary>Caption guidance</summary>');
  expect(html).toContain('Short caption with a question');
  expect(html).toContain('18:00–23:59 UTC');
  expect(html).toContain('1 prior example(s)');
  expect(html).toContain('not a performance prediction');
  expect(html).not.toContain(id); expect(html).not.toContain(receipt.captionSha256);
});
it('does not attribute edited captions to an earlier receipt', () => {
  const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: 'Edited' }} receipts={{ instagram: receipt }} />);
  expect(html).toContain('Caption changed since generation');
  expect(html).not.toContain('Short caption with a question');
});
it('renders versioned hook and format evidence without exposing private payloads', () => {
  const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={{ instagram: {
    ...receipt,
    selectedArm: 'v2:short:question:hook=question:format=reel',
    context: 'learn-v2:scheduled-utc-3',
    hookType: 'question', format: 'reel',
  } }} />);
  expect(html).toContain('question hook');
  expect(html).toContain('reel format');
  expect(html).toContain('18:00–23:59 UTC');
});
it('keeps absent evidence distinct from a verified empty selection', () => {
  expect(renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={undefined} />)).toContain('No generation-guidance receipt recorded');
  const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={{ instagram: {
    ...receipt, selectedArm: null, exemplarIds: [], context: 'learn-v1:scheduled-utc-unknown',
  } }} />);
  expect(html).toContain('No learned caption structure selected');
  expect(html).toContain('No scheduled-time context');
});
it.each([{ version: 'fake' }, { selectedArm: '__proto__' }, { context: 'https://private.invalid' }, { exemplarIds: ['private'] }])(
  'does not render malformed evidence %#', patch => {
    const html = renderToStaticMarkup(<CaptionGuidance captions={{ instagram: caption }} receipts={{ instagram: { ...receipt, ...patch } as typeof receipt }} />);
    expect(html).toContain('Guidance evidence could not be verified');
    expect(html).not.toContain('https://private.invalid');
  },
);
