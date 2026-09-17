import { api, getSession } from '@/lib/api';
import OrgSettingsForm from '@/components/OrgSettingsForm';
import RecoverDigestSchedule from '@/components/RecoverDigestSchedule';
export const dynamic = 'force-dynamic';
export default async function SettingsPage() {
  const session = await getSession();
  if (session?.user?.role !== 'owner') return <div className="card" role="alert"><h1>Workspace settings</h1><p>Only a workspace owner can view or change organization settings.</p></div>;
  try { const settings = (await api.orgSettings.get()).data; return <div className="page-stack"><h1>Workspace settings</h1><OrgSettingsForm initial={settings} /><RecoverDigestSchedule scheduleId={settings.weeklyDigestScheduleId} /></div>; }
  catch { return <div className="card" role="alert"><h1>Workspace settings</h1><p>Settings could not be loaded. Refresh to try again.</p></div>; }
}
