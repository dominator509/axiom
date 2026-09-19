import { api, getSession } from '@/lib/api';
import OrgSettingsForm from '@/components/OrgSettingsForm';
import RecoverDigestSchedule from '@/components/RecoverDigestSchedule';
import UiLocaleControl from '@/components/UiLocaleControl';
export const dynamic = 'force-dynamic';
export default async function SettingsPage() {
  const session = await getSession();
  try {
    const locale = (await api.uiLocale.get()).data;
    if (session?.user?.role !== 'owner') return <div className="page-stack"><h1>Settings</h1><UiLocaleControl initial={locale} /></div>;
    const settings = (await api.orgSettings.get()).data;
    return <div className="page-stack"><h1>Workspace settings</h1><UiLocaleControl initial={locale} /><OrgSettingsForm initial={settings} /><RecoverDigestSchedule scheduleId={settings.weeklyDigestScheduleId} /></div>;
  }
  catch { return <div className="card" role="alert"><h1>Workspace settings</h1><p>Settings could not be loaded. Refresh to try again.</p></div>; }
}
