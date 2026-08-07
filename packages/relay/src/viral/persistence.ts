// ─── Viral persistence hook (M-7) ───
// The relay package stays persistence-free; the API process injects a
// DB-backed implementation (see packages/api/src/relay-viral.ts), mirroring
// the CommandExecutor injection for relay commands. When the hook is absent
// (unit tests / standalone), routes fall back to the in-memory ViralLoop.

import type { PostMetrics, ViralLabel } from './loop.js';

export interface ViralPersistInput {
  postId: string;
  metrics: PostMetrics;
  /** Org context — set by the API's requireAuth middleware. */
  orgId?: string;
}

export interface ViralListInput {
  platform: string;
  limit: number;
  /** Org context — set by the API's requireAuth middleware. */
  orgId?: string;
}

export interface ViralPersistence {
  /** Persist ingested metrics to post_metric + enqueue viral.label; returns the label. */
  persist(input: ViralPersistInput): Promise<{ label: ViralLabel }>;
  /** List exemplars from the DB-backed viral_exemplar table. */
  listExemplars(input: ViralListInput): Promise<Array<Record<string, unknown>>>;
}
