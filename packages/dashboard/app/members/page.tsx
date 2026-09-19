import Link from 'next/link';
import { getSession } from '@/lib/api';
import WorkspaceMembers from '@/components/WorkspaceMembers';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const session = await getSession();
  if (session?.user?.role !== 'owner') return <div className="card stack"><h1>Workspace members</h1><p>Only a workspace owner can manage member access.</p><Link href="/" className="btn secondary">Back to workspace</Link></div>;
  return <div className="page-stack"><h1>Workspace members</h1><p>Manage existing members of this workspace. This does not invite users or move accounts between workspaces. Talent assignments and shifts are managed from each talent’s Team page.</p><WorkspaceMembers /></div>;
}
