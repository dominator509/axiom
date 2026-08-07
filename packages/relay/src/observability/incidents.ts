import { Logger } from './logging.js';

export type Severity = 'sev-1' | 'sev-2' | 'sev-3' | 'sev-4';

export interface Incident {
  id: string;
  severity: Severity;
  message: string;
  source: string;
  timestamp: number;
  resolved: boolean;
  crashLoop: boolean;
  /** Optional context threaded from the reporter (e.g. orgId for the sink). */
  meta?: Record<string, unknown>;
}

export interface DLQEntry {
  id: string;
  originalPayload: unknown;
  error: string;
  source: string;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

interface CrashLoopWindow {
  failures: number[];
  windowMs: number;
  threshold: number;
}

export class IncidentManager {
  private incidents: Incident[] = [];
  private dlq: DLQEntry[] = [];
  private crashLoops: Map<string, CrashLoopWindow> = new Map();
  private logger: Logger;
  private pageHandler?: (incident: Incident) => Promise<void>;

  constructor() {
    this.logger = new Logger('incident-manager');
  }

  setPageHandler(handler: (incident: Incident) => Promise<void>): void {
    this.pageHandler = handler;
  }

  reportIncident(severity: Severity, message: string, source: string, meta?: Record<string, unknown>): Incident {
    const now = Date.now();
    const crashLoop = this.detectCrashLoop(source, now);

    const incident: Incident = {
      id: `inc-${now}-${Math.random().toString(36).slice(2, 8)}`,
      severity,
      message,
      source,
      timestamp: now,
      resolved: false,
      crashLoop,
      meta,
    };

    this.incidents.push(incident);
    this.logger.error(`Incident reported: [${severity}] ${message}`, undefined, { source, incidentId: incident.id, crashLoop });

    if (severity === 'sev-1' || crashLoop) {
      this.autoPage(incident).catch((err) =>
        this.logger.error('Auto-page failed', err as Error),
      );
    }

    return incident;
  }

  private detectCrashLoop(source: string, now: number): boolean {
    const windowMs = 300_000; // 5 min
    const threshold = 5;

    let window = this.crashLoops.get(source);
    if (!window) {
      window = { failures: [], windowMs, threshold };
      this.crashLoops.set(source, window);
    }

    window.failures.push(now);
    const cutoff = now - windowMs;
    window.failures = window.failures.filter((t) => t > cutoff);

    return window.failures.length >= threshold;
  }

  async autoPage(incident: Incident): Promise<void> {
    if (this.pageHandler) {
      await this.pageHandler(incident);
    } else {
      this.logger.warn('No page handler configured for auto-page', { incidentId: incident.id });
    }
  }

  enqueueDLQ(entry: Omit<DLQEntry, 'id' | 'timestamp' | 'retryCount'>): DLQEntry {
    const dlqEntry: DLQEntry = {
      ...entry,
      id: `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      retryCount: 0,
    };
    this.dlq.push(dlqEntry);
    this.logger.warn('Item enqueued to DLQ', { dlqId: dlqEntry.id, source: entry.source });
    return dlqEntry;
  }

  async replayDLQ(dlqId: string, handler: (payload: unknown) => Promise<void>): Promise<boolean> {
    const entry = this.dlq.find((d) => d.id === dlqId);
    if (!entry) {
      this.logger.error('DLQ entry not found', undefined, { dlqId });
      return false;
    }

    if (entry.retryCount >= entry.maxRetries) {
      this.logger.error('DLQ entry max retries exceeded', undefined, { dlqId, retryCount: entry.retryCount });
      return false;
    }

    try {
      entry.retryCount++;
      await handler(entry.originalPayload);
      this.dlq = this.dlq.filter((d) => d.id !== dlqId);
      this.logger.info('DLQ entry replayed successfully', { dlqId });
      return true;
    } catch (err) {
      this.logger.error('DLQ replay failed', err as Error, { dlqId, retryCount: entry.retryCount });
      return false;
    }
  }

  getIncidents(): Incident[] {
    return [...this.incidents];
  }

  getDLQ(): DLQEntry[] {
    return [...this.dlq];
  }

  resolveIncident(incidentId: string): boolean {
    const incident = this.incidents.find((i) => i.id === incidentId);
    if (!incident) return false;
    incident.resolved = true;
    this.logger.info('Incident resolved', { incidentId });
    return true;
  }
}
