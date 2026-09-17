function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function count(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString('en-US') : 'Unavailable';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function Profile({ data }: { data: Record<string, unknown> }) {
  return <section className="stack">
    <h3>{text(data.display_name) || text(data.platform) || 'Profile result'}</h3>
    {text(data.profile_url) && <p style={{ overflowWrap: 'anywhere' }}>{text(data.profile_url)}</p>}
    {text(data.bio) && <p>{text(data.bio)}</p>}
    {text(data.error) ? <p role="alert">Lookup failed: {text(data.error)}</p> : <dl className="stack">
      <div><dt>Followers</dt><dd>{count(data.followers)}</dd></div>
      {'following' in data && <div><dt>Following</dt><dd>{count(data.following)}</dd></div>}
      <div><dt>Posts</dt><dd>{count(data.posts)}</dd></div>
    </dl>}
  </section>;
}

export default function ScrapeResult({ kind, result }: { kind: string; result: unknown }) {
  const data = record(result);
  if (!data) return <p role="alert">Research result could not be displayed.</p>;
  const rows = kind === 'competitor' && Array.isArray(data.results) ? data.results.map(record) : null;
  return <div className="stack">
    <p className="subtle">Observed public-page counts only. Unavailable means not observed, not zero. These are not verified provider analytics.</p>
    {kind === 'social' ? <Profile data={data} /> : rows && rows.length > 0
      ? rows.map((row, index) => row ? <Profile key={index} data={row} /> : <p key={index} role="alert">Invalid profile result.</p>)
      : <p role="alert">No profile results available.</p>}
    <details><summary>Raw research response</summary><pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result, null, 2)}</pre></details>
  </div>;
}
