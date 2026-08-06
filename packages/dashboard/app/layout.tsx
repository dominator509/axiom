import type { Metadata } from 'next';
import './globals.css';
import { getSession } from '@/lib/api';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import KillSwitchBanner from '@/components/KillSwitchBanner';

export const metadata: Metadata = {
  title: 'AXIOM — Fanvue CRM',
  description: 'AXIOM operator dashboard',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              AXIOM
            </Link>
            <nav className="nav">
              <Link href="/">Models</Link>
              <Link href="/audit">Audit</Link>
              <Link href="/incidents">Incidents</Link>
              <Link href="/killswitch">Kill Switch</Link>
            </nav>
            <div className="spacer" />
            <span className="who">{(session as { user?: { email?: string } }).user?.email ?? 'operator'}</span>
          </header>
          <KillSwitchBanner />
          <main className="main">{children}</main>
          <footer className="footer">
            AXIOM FanvueCRM · self-hosted · <Link href="/api/v1/health">health</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
