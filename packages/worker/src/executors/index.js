// ─── Executor registry (L3.4 §2 taxonomy) ───
import { contentGenerate } from './generate.js';
import { tosScan } from './tos.js';
import { relayCard } from './relay_card.js';
import { publishTarget } from './publish.js';
import { metricsPoll } from './metrics.js';
import { viralLabel } from './viral.js';
import { incidentNotify } from './incident.js';
import { dlqReplay } from './dlq.js';
import { digestWeekly } from './digest.js';
export { ParkJobError } from './context.js';
export { contentGenerate, tosScan, relayCard, publishTarget, metricsPoll, viralLabel, incidentNotify, dlqReplay, digestWeekly };
export const defaultExecutors = {
    'content.generate': contentGenerate,
    'tos.scan': tosScan,
    'relay.card': relayCard,
    'publish.target': publishTarget,
    'metrics.poll': metricsPoll,
    'viral.label': viralLabel,
    'incident.notify': incidentNotify,
    'dlq.replay': dlqReplay,
    'digest.weekly': digestWeekly,
};
//# sourceMappingURL=index.js.map