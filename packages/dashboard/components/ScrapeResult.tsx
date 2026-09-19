import type { ScrapeProfileView, ScrapeResultView } from '@axiom/core';

function count(value: number | null): string {
  return value === null ? 'Unavailable' : value.toLocaleString('en-US');
}

function Profile({ data }: { data: ScrapeProfileView }) {
  return <section className="stack">
    <h3>{data.displayName || data.platform || 'Profile result'}</h3>
    {data.profileUrl && <p style={{ overflowWrap: 'anywhere' }}>{data.profileUrl}</p>}
    {data.bio && <p>{data.bio}</p>}
    {data.error && <p role="alert">Profile details unavailable.</p>}
    <dl className="stack">
      <div><dt>Followers</dt><dd>{count(data.followers)}</dd></div>
      <div><dt>Following</dt><dd>{count(data.following)}</dd></div>
      <div><dt>Posts</dt><dd>{count(data.posts)}</dd></div>
    </dl>
    {data.items.length > 0 && <div><h4>Observed items</h4><ul>{data.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
  </section>;
}

const stateLabel: Record<ScrapeResultView['state'], string> = {
  completed: 'Completed research',
  partial: 'Partial research',
  failed: 'Research failed',
  empty: 'No observable results',
  unavailable: 'Research unavailable',
};

export default function ScrapeResult({ result }: { result: ScrapeResultView }) {
  return <div className="stack">
    <p className="subtle">Observed public-page counts only. Unavailable means not observed, not zero. These are not verified provider analytics.</p>
    <p role="status"><strong>{stateLabel[result.state]}</strong> · {result.observedProfiles} observed profile(s)</p>
    {result.failedProfiles > 0 && <p role="alert">{result.failedProfiles} profile lookup(s) were unavailable.</p>}
    {result.profiles.length > 0 ? result.profiles.map((profile, index) => <Profile key={`${index}-${profile.platform ?? 'profile'}`} data={profile} />)
      : <p role="alert">No profile results are available.</p>}
    {result.missingCount !== null && <p className="subtle">Not observed: {result.missingCount.toLocaleString('en-US')} item(s).</p>}
  </div>;
}
