import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';
import ConsentRecordForm from '@/components/ConsentRecordForm';
import RevokeConsentButton from '@/components/RevokeConsentButton';

export const dynamic = 'force-dynamic';

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const { t, locale } = await getServerLocale();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const formatDateOnly = (value: string) => dateOnly.format(new Date(`${value}T00:00:00Z`));
  let records: Awaited<ReturnType<typeof api.models.consentRecords>>['data'] = [];
  let failed = false;
  try {
    records = (await api.models.consentRecords(id)).data;
  } catch {
    failed = true;
  }
  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('consent.title')}</h2>
        <Link href={`/models/${encodeURIComponent(id)}/approvals`}>
          {t('consent.reviewApprovals')}
        </Link>
      </div>
      <p>{t('consent.metadataDescription')}</p>
      {canEdit && <ConsentRecordForm modelId={id} />}
      {!canEdit && <p className="subtle">{t('consent.requiresEditRole')}</p>}
      {failed ? (
        <p role="alert">{t('consent.loadFailed')}</p>
      ) : records.length === 0 ? (
        <p>{t('consent.empty')}</p>
      ) : (
        <div className="grid">
          {records.map((record) => (
            <article key={record.id} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{record.docKind}</h3>
                <span className={`badge ${record.granted ? 'good' : 'mute'}`}>
                  {record.granted ? t('consent.granted') : t('consent.revoked')}
                </span>
              </div>
              <p>
                <strong>{t('consent.platform')}:</strong> {record.platform}
              </p>
              <p>
                <strong>{t('consent.subject')}:</strong> {record.subjectRef}
              </p>
              <p>
                <strong>{t('consent.validity')}:</strong> {formatDateOnly(record.validFrom)} {'→'}{' '}
                {record.validTo ? formatDateOnly(record.validTo) : t('consent.openEnded')}
              </p>
              <p className="mono" style={{ overflowWrap: 'anywhere' }}>
                <strong>{t('consent.digest')}:</strong>{' '}
                {typeof record.sha256 === 'string' ? record.sha256 : t('consent.storedDigest')}
              </p>
              {canEdit && record.granted && (
                <RevokeConsentButton modelId={id} recordId={record.id} />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
