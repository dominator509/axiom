// Presentation only. API authorization remains mandatory for direct requests.
const legacyRoles = new Set(['owner', 'manager', 'operator', 'analyst', 'agent']);
export function workspaceDestinationAllowed(role: string | null | undefined, path: string): boolean {
  if (path === '/') return true;
  if (path === '/members') return role === 'owner';
  if (path === '/connections/grok') return ['owner', 'manager', 'operator', 'content_creator'].includes(role ?? '');
  if (path === '/shifts') return ['owner', 'manager', 'operator', 'chatter'].includes(role ?? '');
  if (path === '/affiliate') return role === 'owner';
  if (path === '/settings') return typeof role === 'string' && role.length > 0;
  if (!role || !legacyRoles.has(role)) return false;
  return role === 'owner' || !['/killswitch', '/settings'].includes(path);
}
export function talentDestinationAllowed(role: string | null | undefined, section: string): boolean {
  if (!section) return true;
  if (section === 'earnings') return ['owner', 'manager', 'model'].includes(role ?? '');
  if (section === 'inbox') return ['owner', 'manager', 'operator', 'model', 'chatter'].includes(role ?? '');
  if (section === 'roleplay') return ['owner', 'manager', 'operator', 'chatter'].includes(role ?? '');
  if (role === 'chatter') return section === 'fans';
  if (role === 'content_creator') return ['generation', 'media', 'approvals', 'calendar', 'analytics', 'playbook'].includes(section);
  if (role === 'model') return ['media', 'calendar', 'fans', 'analytics'].includes(section);
  if (!role || !legacyRoles.has(role)) return false;
  return role === 'owner' || !['network', 'agents'].includes(section);
}
export function roleLabel(role: string | null | undefined): string {
  const labels: Record<string, string> = { owner: 'Owner', manager: 'Manager', operator: 'Operator', analyst: 'Analyst', agent: 'Agent', chatter: 'Chatter', content_creator: 'Content Creator', model: 'Model' };
  return role && Object.hasOwn(labels, role) ? labels[role] : 'Member';
}
