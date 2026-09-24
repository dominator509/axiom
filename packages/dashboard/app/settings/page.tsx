import { api, getSession } from '@/lib/api';
import OrgSettingsForm from '@/components/OrgSettingsForm';
import RecoverDigestSchedule from '@/components/RecoverDigestSchedule';
import UiLocaleControl from '@/components/UiLocaleControl';
import { CATALOGS, LocaleCatalog, normalizeLocale, type SupportedLocale } from '@axiom/core';
export const dynamic = 'force-dynamic';
export default async function SettingsPage() {
  const session = await getSession();
  let locale: SupportedLocale = 'en';
  try { locale = normalizeLocale((await api.uiLocale.get()).data.locale) ?? 'en'; } catch { /* use English when preference loading fails */ }
  const catalog = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values);
  try {
    const uiLocale = await api.uiLocale.get();
    if (session?.user?.role !== 'owner') return <div className="page-stack"><h1>{t('settings.title')}</h1><UiLocaleControl initial={uiLocale.data} /></div>;
    const settings = (await api.orgSettings.get()).data;
    return <div className="page-stack"><h1>{t('settings.workspaceTitle')}</h1><UiLocaleControl initial={uiLocale.data} /><OrgSettingsForm initial={settings} /><RecoverDigestSchedule scheduleId={settings.weeklyDigestScheduleId} /></div>;
  } catch { return <div className="card" role="alert"><h1>{t('settings.workspaceTitle')}</h1><p>{t('settings.loadFailed')}</p></div>; }
}
