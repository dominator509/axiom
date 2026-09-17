import { createHash } from 'node:crypto';
import type { ContentBundle } from '@/lib/api';

const armNames: Record<string, string> = {
  'short:question': 'Short caption with a question', 'short:statement': 'Short statement caption',
  'medium:question': 'Medium caption with a question', 'medium:statement': 'Medium statement caption',
  'long:question': 'Long caption with a question', 'long:statement': 'Long statement caption',
};
type Receipt = NonNullable<ContentBundle['captionGuidance']>[string];
function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as Receipt;
  return r.version === 'caption-guidance-v1' && typeof r.captionSha256 === 'string' && /^[a-f0-9]{64}$/.test(r.captionSha256)
    && (r.selectedArm === null || (typeof r.selectedArm === 'string' && Object.hasOwn(armNames, r.selectedArm)))
    && typeof r.context === 'string' && /^learn-v1:scheduled-utc-(unknown|[0-3])$/.test(r.context)
    && Array.isArray(r.exemplarIds) && r.exemplarIds.length <= 50 && r.exemplarIds.every(id => typeof id === 'string'
      && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id));
}

/** Server-rendered evidence summary. No exemplar text, identifiers or hashes are exposed. */
export default function CaptionGuidance({ captions, receipts }: {
  captions: Record<string, string>; receipts: ContentBundle['captionGuidance'];
}) {
  const entries = Object.entries(captions);
  if (!entries.length) return null;
  return <details className="card stack">
    <summary>Caption guidance</summary>
    <p>What informed the generated caption. This is not a performance prediction or proof that the guidance caused an outcome.</p>
    {entries.map(([platform, caption]) => {
      const receipt = receipts?.[platform];
      if (!receipt) return <p key={platform}><strong>{platform}:</strong> No generation-guidance receipt recorded. Manual, fallback and older drafts may have none.</p>;
      if (!validReceipt(receipt)) return <p key={platform}><strong>{platform}:</strong> Guidance evidence could not be verified.</p>;
      if (createHash('sha256').update(caption, 'utf8').digest('hex') !== receipt.captionSha256)
        return <p key={platform}><strong>{platform}:</strong> Caption changed since generation. The recorded guidance will not be attributed to this edited caption.</p>;
      const bucket = receipt.context.slice('learn-v1:scheduled-utc-'.length);
      return <div key={platform} className="stack">
        <h4>{platform}</h4>
        <p>{receipt.selectedArm ? armNames[receipt.selectedArm] : 'No learned caption structure selected'}.</p>
        <p>{receipt.exemplarIds.length} prior example(s) supplied. This does not prove the generated caption followed them.</p>
        <p>{bucket === 'unknown' ? 'No scheduled-time context was available at generation.'
          : `Selection context: ${String(Number(bucket) * 6).padStart(2, '0')}:00–${String(Number(bucket) * 6 + 5).padStart(2, '0')}:59 UTC. This does not schedule publication.`}</p>
      </div>;
    })}
  </details>;
}
