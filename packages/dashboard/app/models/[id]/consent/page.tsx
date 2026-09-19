import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import ConsentRecordForm from '@/components/ConsentRecordForm';
import RevokeConsentButton from '@/components/RevokeConsentButton';

export const dynamic = 'force-dynamic';
export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let records: Awaited<ReturnType<typeof api.models.consentRecords>>['data'] = [];
  let failed = false;
  try { records = (await api.models.consentRecords(id)).data; } catch { failed = true; }
  return <div className="page-stack">
    <div className="row" style={{ justifyContent: 'space-between' }}><h2>Consent vault</h2><Link href={`/models/${encodeURIComponent(id)}/approvals`}>Review approvals</Link></div>
    <p>Metadata-only records used by publication gates. Document bytes stay in the encrypted object store; this screen never accepts document contents.</p>
    {canEdit && <ConsentRecordForm modelId={id} />}
    {!canEdit && <p className="subtle">Adding or revoking consent requires an owner, manager or operator role.</p>}
    {failed ? <p role="alert">Consent records could not be loaded. Refresh to try again.</p> : records.length === 0 ? <p>No consent records are registered for this talent.</p> : <div className="grid">
      {records.map(record => <article key={record.id} className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3>{record.docKind}</h3><span className={`badge ${record.granted ? 'good' : 'mute'}`}>{record.granted ? 'granted' : 'revoked'}</span></div>
        <p><strong>Platform:</strong> {record.platform}</p><p><strong>Subject:</strong> {record.subjectRef}</p>
        <p><strong>Validity:</strong> {record.validFrom} → {record.validTo ?? 'open-ended'}</p>
        <p className="mono" style={{ overflowWrap: 'anywhere' }}><strong>Digest:</strong> {typeof record.sha256 === 'string' ? record.sha256 : '[stored digest]'}</p>
        {canEdit && record.granted && <RevokeConsentButton modelId={id} recordId={record.id} />}
      </article>)}
    </div>}
  </div>;
}
