import { getServerLocale } from '@/lib/server-locale';

export default async function InboxLoading() {
  const { t } = await getServerLocale();
  return <div className="card stack" role="status"><h2>{t('modelSurface.loadingInbox')}</h2><p>{t('modelSurface.loadingInboxDescription')}</p></div>;
}
