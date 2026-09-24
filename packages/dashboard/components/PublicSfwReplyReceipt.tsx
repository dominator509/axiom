'use client';

import { useLocale } from './LocaleProvider';

export interface PublicSfwReplyReceiptData {
  jobId: string;
  commentId: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled';
  scheduledFor: string | null;
  text: string;
}

export default function PublicSfwReplyReceipt({ receipt }: { receipt: PublicSfwReplyReceiptData }) {
  const { locale, t } = useLocale();
  const statusText = receipt.status === 'queued'
    ? t('network.publicSfwQueued')
    : t(`network.publicSfwStatus.${receipt.status}`);
  const scheduledFor = receipt.scheduledFor
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
      .format(new Date(receipt.scheduledFor))
    : null;

  return <div role="status" aria-live="polite">
    <p>{statusText}{scheduledFor ? <> <time dateTime={receipt.scheduledFor!}>{scheduledFor}</time></> : null}</p>
    <p>{receipt.text}</p>
    {(receipt.status === 'unknown' || receipt.status === 'failed') && <p>
      {t('network.publicSfwJobId')}: <code>{receipt.jobId}</code>{' '}
      <a href="/incidents">{t('network.publicSfwIncident')}</a>
    </p>}
  </div>;
}
