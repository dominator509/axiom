import { useLocale } from './LocaleProvider';

export default function GeneratedCaptionReceipt({ captions, enrichment }: { captions: unknown; enrichment: unknown }) {
  const { t } = useLocale();
  if (!captions || typeof captions !== 'object' || Array.isArray(captions)) return null;
  const status = enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)
    ? enrichment as Record<string, unknown> : {};
  return <section className="stack" aria-label={t('caption.savedCaptions')}>
    <h3>{t('caption.savedCaptions')}</h3>
    <p className="subtle">{t('caption.savedDescription')}</p>
    {Object.entries(captions).map(([platform, caption]) => typeof caption === 'string' && <article className="card stack" key={platform}>
      <h4>{platform}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{caption}</p>
      {status[platform] === 'fallback' ? <p role="alert">{t('caption.fallback')}</p>
        : <p className="subtle">{status[platform] === 'enriched' ? t('caption.enriched') : status[platform] === 'not_requested' ? t('caption.notRequested') : t('caption.statusUnavailable')}</p>}
    </article>)}
  </section>;
}
