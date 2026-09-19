import { api, getSession } from '@/lib/api';
import PlaybookGuidelineManager from '@/components/PlaybookGuidelineManager';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import Link from 'next/link';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

interface PlaybookData {
  score: {
    overall: number;
    components: Record<string, number>;
    passed: boolean;
  };
  history: Array<{ id: string; score: number; ts: string }>;
  cadencePerDay: number;
  postCount30d: number;
  scheduleCount30d: number;
}

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, dateTime } = await getServerLocale();
  const session = await getSession();
  if (!talentDestinationAllowed(session?.user?.role, 'playbook')) return <div className="card"><h2>{t('playbook.accessUnavailable')}</h2><p>{t('playbook.accessDescription')}</p><Link href="/">{t('playbook.back')}</Link></div>;
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let guidelines = [] as Awaited<ReturnType<typeof api.models.playbookGuidelines>>['data'];
  let guidelinesUnavailable = false;
  try { guidelines = (await api.models.playbookGuidelines(id)).data; } catch { guidelinesUnavailable = true; }
  const guidelinePanel = guidelinesUnavailable
    ? <div className="card stack" role="alert"><p>{t('playbook.guidelinesLoadFailed')}</p></div>
    : <PlaybookGuidelineManager modelId={id} initial={guidelines} canEdit={canEdit} />;
  let data: PlaybookData | null = null;
  try {
    data = (await api.models.playbookScore(id)).data as unknown as PlaybookData;
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <div className="page-stack">
        <h2>{t('playbook.title')}</h2>
        <div className="card">
          <p style={{ color: 'var(--muted)' }}>{t('playbook.scoreUnavailable')}</p>
        </div>
        {guidelinePanel}
      </div>
    );
  }

  const pct = Math.round(data.score.overall * 100);

  return (
    <div className="page-stack">
      <h2>{t('playbook.title')}</h2>
      <div className="grid">
        <div className="card">
          <h3>{t('playbook.currentScore')}</h3>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{pct}%</div>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {data.score.passed
              ? t('playbook.adherent')
              : t('playbook.belowThreshold')}
          </p>
        </div>
        <div className="card">
          <h3>{t('playbook.cadence')}</h3>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('playbook.postsPerDay')}</span>
            <strong>{data.cadencePerDay.toFixed(2)}</strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('playbook.published')}</span>
            <strong>{data.postCount30d}</strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('playbook.scheduled')}</span>
            <strong>{data.scheduleCount30d}</strong>
          </div>
        </div>
      </div>
      {data.history.length > 0 && (
        <div className="card">
          <h3>{t('playbook.scoreHistory')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t('playbook.when')}</th>
                <th>{t('playbook.score')}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td>{dateTime(h.ts)}</td>
                  <td>{h.score}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {guidelinePanel}
    </div>
  );
}
