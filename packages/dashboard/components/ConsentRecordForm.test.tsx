import { expect, it } from 'vitest';
import { consentPayload } from './ConsentRecordForm';
function data(values: Record<string, string>) { const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value); return form; }
it('accepts metadata-only consent input and rejects invalid digests/ranges', () => {
  const valid = data({ platform: 'fanvue', docKind: 'model_release', subjectRef: 'model-1', blobRef: 'r2://encrypted/one', sha256: 'A'.repeat(64), validFrom: '2026-01-01', validTo: '2027-01-01' });
  expect(consentPayload(valid)).toMatchObject({ platform: 'fanvue', sha256: 'a'.repeat(64), validFrom: '2026-01-01' });
  valid.set('sha256', 'bad'); expect(() => consentPayload(valid)).toThrow('SHA-256');
  valid.set('sha256', 'a'.repeat(64)); valid.set('validTo', '2025-01-01'); expect(() => consentPayload(valid)).toThrow('date range');
});
