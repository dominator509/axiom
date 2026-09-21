import { getServerLocale } from '@/lib/server-locale';

export default async function EarningsLoading() {
  const { t } = await getServerLocale();
  return <div className="card stack" role="status" aria-live="polite">
    <h2>{t('modelSurface.loadingEarnings')}</h2>
    <p>{t('modelSurface.loadingEarningsDescription')}</p>
  </div>;
}
