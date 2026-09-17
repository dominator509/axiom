export default function GeneratedCaptionReceipt({ captions, enrichment }: { captions: unknown; enrichment: unknown }) {
  if (!captions || typeof captions !== 'object' || Array.isArray(captions)) return null;
  const status = enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)
    ? enrichment as Record<string, unknown> : {};
  return <section className="stack" aria-label="Saved captions">
    <h3>Saved destination captions</h3>
    <p className="subtle">These captions are saved in the bundle for review. The creative variants below are suggestions, not additional scheduled posts.</p>
    {Object.entries(captions).map(([platform, caption]) => typeof caption === 'string' && <article className="card stack" key={platform}>
      <h4>{platform}</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{caption}</p>
      {status[platform] === 'fallback' ? <p role="alert">Optional AI enrichment was unavailable or returned no caption. The base caption was saved. Review it before approval; do not regenerate the whole bundle just to check this result.</p>
        : <p className="subtle">{status[platform] === 'enriched' ? 'AI-enriched caption saved.' : status[platform] === 'not_requested' ? 'AI enrichment was not requested.' : 'Enrichment status is unavailable for this receipt.'}</p>}
    </article>)}
  </section>;
}
