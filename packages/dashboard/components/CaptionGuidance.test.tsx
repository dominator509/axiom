import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { useLocale } from './LocaleProvider';
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
        'caption.guidance': 'Caption guidance',
        'caption.guidanceDescription': 'What informed the generated caption. This is not a performance prediction or proof that the guidance caused an outcome.',
        'caption.noReceipt': 'No generation-guidance receipt recorded. Manual, fallback and older drafts may have none.',
        'caption.invalidReceipt': 'Guidance evidence could not be verified.',
        'caption.changed': 'Caption changed since generation. The recorded guidance will not be attributed to this edited caption.',
        'caption.unknownStructure': 'Unknown caption structure',
        'caption.shortQuestion': 'Short caption with a question',
        'caption.shortStatement': 'Short statement caption',
        'caption.mediumQuestion': 'Medium caption with a question',
        'caption.mediumStatement': 'Medium statement caption',
        'caption.longQuestion': 'Long caption with a question',
        'caption.longStatement': 'Long statement caption',
        'caption.hook': 'hook',
        'caption.format': 'format',
        'caption.unknown': 'unknown',
        'caption.noStructure': 'No learned caption structure selected',
        'caption.priorExamples': '{count} prior example(s) supplied. This does not prove the generated caption followed them.',
        'caption.noScheduledContext': 'No scheduled-time context was available at generation.',
        'caption.selectionContext': 'Selection context: {from}:00–{to}:59 UTC. This does not schedule publication.',
      }[key] ?? key);
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, name: string) => String(values?.[name] ?? _match));
    },
  }),
}));
const localizedProps = () => {
  const { locale, t } = useLocale();
  return { locale, t };
};
import CaptionGuidance from './CaptionGuidance';
const id = '11111111-1111-4111-8111-111111111111';
const caption = 'Original caption?';
const receipt = { version: 'caption-guidance-v1' as const, selectedArm: 'short:question',
  context: 'learn-v1:scheduled-utc-3', exemplarIds: [id], captionSha256: createHash('sha256').update(caption).digest('hex') };
it('explains matched guidance without exposing exemplar identifiers or claiming performance', () => {
  const html = renderToStaticMarkup(<CaptionGuidance {...localizedProps()} captions={{ instagram: caption }} receipts={{ instagram: receipt }} />);
  expect(html).toContain('<summary>Caption guidance</summary>');
  expect(html).toContain('Short caption with a question');
  expect(html).toContain('18:00–23:59 UTC');
  expect(html).toContain('1 prior example(s)');
  expect(html).toContain('not a performance prediction');
  expect(html).not.toContain(id); expect(html).not.toContain(receipt.captionSha256);
});
it('does not attribute edited captions to an earlier receipt', () => {
  const html = renderToStaticMarkup(<CaptionGuidance {...localizedProps()} captions={{ instagram: 'Edited' }} receipts={{ instagram: receipt }} />);
  expect(html).toContain('Caption changed since generation');
  expect(html).not.toContain('Short caption with a question');
});
it('renders versioned hook and format evidence without exposing private payloads', () => {
  const html = renderToStaticMarkup(<CaptionGuidance {...localizedProps()} captions={{ instagram: caption }} receipts={{ instagram: {
    ...receipt,
    selectedArm: 'v2:short:question:hook=question:format=reel:time=morning',
    context: 'learn-v2:scheduled-utc-3',
    hookType: 'question', format: 'reel', timingBucket: 'morning',
  } }} />);
  expect(html).toContain('question hook');
  expect(html).toContain('reel format');
  expect(html).toContain('morning timing');
  expect(html).toContain('18:00–23:59 UTC');
});
it('keeps absent evidence distinct from a verified empty selection', () => {
  expect(renderToStaticMarkup(<CaptionGuidance {...localizedProps()} captions={{ instagram: caption }} receipts={undefined} />)).toContain('No generation-guidance receipt recorded');
  const html = renderToStaticMarkup(<CaptionGuidance {...localizedProps()} captions={{ instagram: caption }} receipts={{ instagram: {
    ...receipt, selectedArm: null, exemplarIds: [], context: 'learn-v1:scheduled-utc-unknown',
  } }} />);
  expect(html).toContain('No learned caption structure selected');
  expect(html).toContain('No scheduled-time context');
});
it.each([{ version: 'fake' }, { selectedArm: '__proto__' }, { context: 'https://private.invalid' }, { exemplarIds: ['private'] }])(
  'does not render malformed evidence %#', patch => {
    const html = renderToStaticMarkup(<CaptionGuidance {...localizedProps()} captions={{ instagram: caption }} receipts={{ instagram: { ...receipt, ...patch } as typeof receipt }} />);
    expect(html).toContain('Guidance evidence could not be verified');
    expect(html).not.toContain('https://private.invalid');
  },
);
