import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import ModelTabs from '@/components/ModelTabs';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function ModelLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const session = await getSession();
  const { t } = await getServerLocale();
  let model;
  try {
    model = (await api.models.get(id)).data;
  } catch {
    notFound();
  }

  return (
    <div className="page-stack">
      <header className="talent-header">
        <div>
          <Link href="/" className="back-link">
            <span aria-hidden="true">←</span> {t('modelSurface.talentPortfolio')}
          </Link>
          <div className="talent-identity">
            <span className="talent-avatar">{model.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <p className="eyebrow">{t('modelSurface.talentWorkspace')}</p>
              <h1>{model.displayName}</h1>
              <p className="subtle">@{model.handle}</p>
            </div>
          </div>
        </div>
        {model.isActive ? (
          <span className="badge good">
            <i /> {t('modelSurface.active')}
          </span>
        ) : (
          <span className="badge mute">
            <i /> {t('modelSurface.inactive')}
          </span>
        )}
      </header>
      <ModelTabs modelId={id} role={session?.user?.role} />
      {children}
    </div>
  );
}
