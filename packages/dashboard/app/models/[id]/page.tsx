import { api } from '@/lib/api';
import CharacterLockEditor from '@/components/CharacterLockEditor';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ModelOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let model;
  let network;
  let calendarCount: number | null = null;
  let fanCount: number | null = null;
  let networkFailed = false;
  try {
    model = (await api.models.get(id)).data;
  } catch {
    model = null;
  }
  try {
    network = (await api.models.network(id)).data;
  } catch {
    network = null;
    networkFailed = true;
  }
  try {
    calendarCount = (await api.models.calendar(id)).data.length;
  } catch {
    calendarCount = null;
  }
  try {
    fanCount = (await api.models.fans(id)).data.length;
  } catch {
    fanCount = null;
  }

  if (!model) return <div className="card stack" role="alert">
    <h2>Profile unavailable</h2>
    <p>We could not load this profile. Return to your talent list and try again.</p>
    <Link href="/" className="btn secondary">Back to talent</Link>
  </div>;

  return (
    <div className="grid">
      <div className="card stack">
        <h3>Profile</h3>
        <div>
          <strong>Handle:</strong> @{model.handle}
        </div>
        <div>
          <strong>Bio:</strong> {model.bio ?? '—'}
        </div>
        {typeof model.characterLockPrompt === 'string' && Number.isSafeInteger(model.characterLockVersion)
          ? <CharacterLockEditor key={`${model.id}:${model.characterLockVersion}`} modelId={model.id}
            initialPrompt={model.characterLockPrompt} initialVersion={model.characterLockVersion!} />
          : <p>Character lock editing is unavailable until the profile API and migration are installed.</p>}
        <div>
          <strong>Created:</strong> {new Date(model.createdAt).toLocaleDateString()}
        </div>
      </div>
      <div className="card stack">
        <h3>Network &amp; security</h3>
        {network ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Egress</span>
              <span className="mono">{network.egressMode}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Health</span>
              {network.healthy ? (
                <span className="badge good">healthy</span>
              ) : (
                <span className="badge bad">degraded</span>
              )}
            </div>
            {network.latencyMs != null && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Latency</span>
                <span>{network.latencyMs} ms</span>
              </div>
            )}
            {network.lastEgressIp && (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Egress IP</span>
                <span className="mono">{network.lastEgressIp}</span>
              </div>
            )}
            {network.lastError && <div style={{ color: 'var(--bad)' }}>{network.lastError}</div>}
          </>
        ) : (
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {networkFailed ? 'Network status could not be loaded.' : 'No network configuration yet.'}
          </p>
        )}
        <Link href={`/models/${id}/network`} className="btn secondary">Open network settings</Link>
      </div>
      <div className="card stack">
        <h3>Activity</h3>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/models/${id}/calendar`}>View schedule</Link>
          <strong>{calendarCount ?? 'Unavailable'}</strong>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/models/${id}/fans`}>View fan contacts</Link>
          <strong>{fanCount ?? 'Unavailable'}</strong>
        </div>
        <p className="subtle">Counts reflect the records returned for this overview. Open each section for details.</p>
        <Link href={`/models/${id}/generation`} className="btn">Create content</Link>
        <Link href={`/models/${id}/approvals`} className="btn secondary">Review saved content</Link>
      </div>
    </div>
  );
}
