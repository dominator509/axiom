import type { VariantGuidanceSummary as Guidance } from '@/lib/api';

export default function VariantGuidanceSummary({ guidance }: { guidance?: Guidance | null }) {
  if (!guidance) return <p className="subtle">Guidance attribution unavailable. No performance conclusion is implied.</p>;
  const details = [guidance.hookType && `hook: ${guidance.hookType}`, guidance.format && `format: ${guidance.format}`, guidance.postingHourUtc !== undefined && `hour: ${guidance.postingHourUtc}:00 UTC`, guidance.timingBucket && `timing: ${guidance.timingBucket}`].filter(Boolean).join(' · ');
  return <div className="stack"><strong>Verified guidance attribution</strong><span className="subtle">{guidance.selectedArm ?? 'No learned structure selected'} · {details || 'Hook, format, and timing unavailable'}</span><span className="subtle">Source bundle {guidance.sourceBundleId.slice(0, 8)} · recorded provenance only; this does not prove causality, performance, or publication.</span></div>;
}
