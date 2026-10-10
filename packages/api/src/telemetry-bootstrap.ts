import { initializeTelemetry } from '@axiom/observability';

initializeTelemetry(process.env.AXIOM_SERVICE_NAME ?? 'api');
