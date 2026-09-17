import GrokConnection from '@/components/GrokConnection';
import GrokR2Storage from '@/components/GrokR2Storage';
import Link from 'next/link';
import { getSession } from '@/lib/api';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';

export default async function GrokConnectionPage() {
  const role = (await getSession())?.user?.role;
  if (!workspaceDestinationAllowed(role, '/connections/grok')) return <section className="card stack">
    <h1>Grok connection access</h1><p>Your role does not include managing generation accounts or storage.</p>
    <Link href="/" className="btn secondary">Back to workspace</Link>
  </section>;
  return <section className="stack">
    <h1>Connect your Grok account</h1>
    <p>This only connects your account. It does not generate or publish media.</p>
    <GrokConnection />
    {role !== 'content_creator' ? <GrokR2Storage /> : <p>Storage configuration is not available to Content Creators. If generation requires storage setup, contact your workspace owner before starting a job.</p>}
  </section>;
}
