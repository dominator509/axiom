// ─── Relay incident page sink (F-78, L2.9) — DB-backed, injected by the API ───
// The relay's IncidentManager detects sev-1 / crash-loop conditions and calls
// its pageHandler. This implementation is that handler: it writes a durable,
// org-scoped relay_card (channel 'incident') plus an audit entry — the external
// sink that was missing (previously the handler was unset and auto-page only
// logged a warning). Org comes from incident.meta.orgId, threaded by the relay
// route from the authenticated session; without it there is nothing to scope
// the row to, so we fail closed (no write, no partial card).

import { schema } from '@axiom/db';
import { withOrgContext, writeAudit } from './routes/helpers.js';
import type { Incident } from '@axiom/relay';

export async function relayIncidentPageHandler(incident: Incident): Promise<void> {
  const orgId = incident.meta?.orgId;
  if (typeof orgId !== 'string' || orgId.length === 0) {
    // No org context — nothing honest to persist against. The in-memory
    // manager still records the incident for the session.
    return;
  }

  const severity = incident.severity;
  const priority = severity === 'sev-1' ? 20 : incident.crashLoop ? 15 : 5;

  await withOrgContext(orgId, async (tx) => {
    const card = await tx
      .insert(schema.relayCard)
      .values({
        orgId,
        channel: 'incident',
        state: 'sent',
        title: incident.crashLoop
          ? `⚠️ Crash loop detected: ${incident.source}`
          : `🚨 ${severity}: ${incident.message}`,
        description: incident.message,
        icon: '🚨',
        priority,
        config: {
          severity,
          source: incident.source,
          crashLoop: incident.crashLoop,
          incidentId: incident.id,
          oneTapMitigation: 'Pause this model or enable the global kill switch from the dashboard.',
        },
      })
      .returning({ id: schema.relayCard.id });
    await writeAudit(tx, orgId, 'relay:incident-manager', 'incident.page', incident.id, {
      severity,
      source: incident.source,
      crashLoop: incident.crashLoop,
      cardId: card[0]?.id ?? null,
    });
  });
}
