// ─── digest.weekly executor (F-28, L2.7/L2.9) ───
// Builds a 7-day performance digest for the org and stores it as a durable
// relay_card (channel 'digest') so the operator sees "what worked this week"
// on the phone. Real aggregates over post_metric (TimescaleDB hypertable) +
// viral_exemplar labels. Org context is set by the worker (set_config), and
// the SQL also filters by org_id explicitly.

import { sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { Executor, ExecutorContext } from './context.js';

export interface WeeklyDigest {
  weekStart: string;
  posts: number;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  avgEngagement: number;
  topPlatform: string;
  viralPosts: number;
  strongPosts: number;
}

export const digestWeekly: Executor = async (ctx: ExecutorContext) => {
  const { tx, job } = ctx;
  const since = new Date(Date.now() - 7 * 24 * 3600_000);

  // 1. 7-day aggregates from the metrics hypertable.
  const aggRows = await tx.execute(sql`
    SELECT count(*)::int AS posts,
           coalesce(sum(pm.views), 0)::bigint AS views,
           coalesce(sum(pm.likes), 0)::bigint AS likes,
           coalesce(sum(pm.shares), 0)::bigint AS shares,
           coalesce(sum(pm.comments), 0)::bigint AS comments,
           coalesce(avg(pm.engagement_rate), 0)::float8 AS avg_engagement
    FROM post_metric pm
    JOIN post_target pt ON pt.id = pm.post_target_id
    JOIN content_bundle cb ON cb.id = pt.bundle_id
    WHERE cb.org_id = ${job.org_id}
      AND pm.collected_at >= ${since}
  `);
  const agg = Array.isArray(aggRows) ? aggRows[0] : (aggRows as { rows: unknown[] }).rows?.[0];

  // 2. Top platform by views over the window.
  const topRows = await tx.execute(sql`
    SELECT pm.platform, sum(pm.views)::bigint AS views
    FROM post_metric pm
    JOIN post_target pt ON pt.id = pm.post_target_id
    JOIN content_bundle cb ON cb.id = pt.bundle_id
    WHERE cb.org_id = ${job.org_id}
      AND pm.collected_at >= ${since}
    GROUP BY pm.platform
    ORDER BY views DESC
    LIMIT 1
  `);
  const topRow = Array.isArray(topRows) ? topRows[0] : (topRows as { rows: unknown[] }).rows?.[0];

  // 3. Viral exemplars labeled in the window (viral/strong).
  const labelRows = await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE ve.label = 'viral')::int AS viral,
      count(*) FILTER (WHERE ve.label = 'strong')::int AS strong
    FROM viral_exemplar ve
    JOIN model_profile mp ON mp.id = ve.model_id
    WHERE mp.org_id = ${job.org_id}
      AND ve.created_at >= ${since}
  `);
  const labelRow = Array.isArray(labelRows)
    ? labelRows[0]
    : (labelRows as { rows: unknown[] }).rows?.[0];

  const digest: WeeklyDigest = {
    weekStart: since.toISOString(),
    posts: Number(agg?.posts ?? 0),
    views: Number(agg?.views ?? 0),
    likes: Number(agg?.likes ?? 0),
    shares: Number(agg?.shares ?? 0),
    comments: Number(agg?.comments ?? 0),
    avgEngagement: Number(agg?.avg_engagement ?? 0),
    topPlatform: String(topRow?.platform ?? 'n/a'),
    viralPosts: Number(labelRow?.viral ?? 0),
    strongPosts: Number(labelRow?.strong ?? 0),
  };

  const description =
    `${digest.posts} posts · ${digest.views.toLocaleString()} views · ` +
    `${digest.avgEngagement.toFixed(2)}% avg engagement · top platform ${digest.topPlatform} · ` +
    `${digest.viralPosts} viral / ${digest.strongPosts} strong labels this week`;

  // 4. Durable digest card (F-28: weekly digests ride the Relay as cards).
  await tx.insert(schema.relayCard).values({
    orgId: job.org_id,
    channel: 'digest',
    state: 'sent',
    title: `Weekly digest — ${since.toISOString().slice(0, 10)}`,
    description,
    icon: '📊',
    config: { digest },
    priority: 5,
  });
};
