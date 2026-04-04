import { Router } from "express";
import { eq, and, inArray, arrayContains, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists } from "../db/schema.js";
import { StatsQuerySchema } from "../schemas.js";
import {
  resolveFeatureDynastySlugs,
  resolveWorkflowDynastySlugs,
  fetchFeatureDynasties,
  fetchWorkflowDynasties,
  buildSlugToDynastyMap,
} from "../lib/dynasty-client.js";
import {
  fetchEmailGatewayStats,
  fetchEmailGatewayStatsGrouped,
  type EmailGatewayStatsParams,
} from "../lib/email-gateway-client.js";

const router = Router();

// ── Shared stats logic ──────────────────────────────────────────────

interface StatsResult {
  totalJournalists: number;
  byStatus: Record<string, number>;
  groupedBy?: Record<string, { totalJournalists: number; byStatus: Record<string, number> }>;
}

function emptyStats(): StatsResult {
  return { totalJournalists: 0, byStatus: {} };
}

function buildPassthroughHeaders(locals: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (locals.orgId) headers["x-org-id"] = locals.orgId as string;
  if (locals.userId) headers["x-user-id"] = locals.userId as string;
  if (locals.runId) headers["x-run-id"] = locals.runId as string;
  return headers;
}

async function resolveFiltersAndQuery(
  query: ReturnType<typeof StatsQuerySchema.parse>,
  passthroughHeaders: Record<string, string>
): Promise<StatsResult> {
  const table = campaignJournalists;

  // Resolve dynasty slugs to versioned slug lists
  let featureSlugs: string[] | null = null;
  let workflowSlugs: string[] | null = null;

  if (query.featureDynastySlug) {
    featureSlugs = await resolveFeatureDynastySlugs(query.featureDynastySlug, passthroughHeaders);
    if (featureSlugs.length === 0) return emptyStats();
  }

  if (query.workflowDynastySlug) {
    workflowSlugs = await resolveWorkflowDynastySlugs(query.workflowDynastySlug, passthroughHeaders);
    if (workflowSlugs.length === 0) return emptyStats();
  }

  // Build WHERE conditions
  const conditions = [];

  if (query.orgId) conditions.push(eq(table.orgId, query.orgId));
  if (query.campaignId) conditions.push(eq(table.campaignId, query.campaignId));
  if (query.outletId) conditions.push(eq(table.outletId, query.outletId));
  if (query.brandId) conditions.push(arrayContains(table.brandIds, [query.brandId]));

  // Dynasty slug (resolved list) takes priority, then explicit list, then exact slug
  if (featureSlugs && featureSlugs.length > 0) {
    conditions.push(inArray(table.featureSlug, featureSlugs));
  } else if (query.featureSlugs && query.featureSlugs.length > 0) {
    conditions.push(inArray(table.featureSlug, query.featureSlugs));
  } else if (query.featureSlug) {
    conditions.push(eq(table.featureSlug, query.featureSlug));
  }

  if (workflowSlugs && workflowSlugs.length > 0) {
    conditions.push(inArray(table.workflowSlug, workflowSlugs));
  } else if (query.workflowSlugs && query.workflowSlugs.length > 0) {
    conditions.push(inArray(table.workflowSlug, query.workflowSlugs));
  } else if (query.workflowSlug) {
    conditions.push(eq(table.workflowSlug, query.workflowSlug));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Query by status
  const rows = await db
    .select({
      status: table.status,
      count: count(),
    })
    .from(table)
    .where(where)
    .groupBy(table.status);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = row.count;
    total += row.count;
  }

  // Enrich with contacted/delivered/replied/bounced from email-gateway (fail-open)
  const gwParams: EmailGatewayStatsParams = {
    campaignId: query.campaignId,
    brandId: query.brandId,
    featureSlug: query.featureSlug,
    featureSlugs: query.featureSlugs,
    workflowSlug: query.workflowSlug,
    featureDynastySlug: query.featureDynastySlug,
    workflowDynastySlug: query.workflowDynastySlug,
  };
  const gwStats = await fetchEmailGatewayStats(gwParams, passthroughHeaders);
  if (gwStats) {
    if (gwStats.emailsContacted > 0) byStatus.contacted = gwStats.emailsContacted;
    if (gwStats.emailsDelivered > 0) byStatus.delivered = gwStats.emailsDelivered;
    if (gwStats.emailsReplied > 0) byStatus.replied = gwStats.emailsReplied;
    if (gwStats.emailsBounced > 0) byStatus.bounced = gwStats.emailsBounced;
  }

  const result: StatsResult = { totalJournalists: total, byStatus };

  // GroupBy dynasty logic
  const groupBy = query.groupBy;
  if (
    groupBy === "featureDynastySlug" ||
    groupBy === "workflowDynastySlug"
  ) {
    const isFeature = groupBy === "featureDynastySlug";
    const slugColumn = isFeature ? table.featureSlug : table.workflowSlug;

    // Fetch all dynasties to build reverse map
    const dynasties = isFeature
      ? await fetchFeatureDynasties(passthroughHeaders)
      : await fetchWorkflowDynasties(passthroughHeaders);
    const slugToDynasty = buildSlugToDynastyMap(dynasties);

    // Query grouped by the raw slug column
    const groupedRows = await db
      .select({
        slug: slugColumn,
        status: table.status,
        count: count(),
      })
      .from(table)
      .where(where)
      .groupBy(slugColumn, table.status);

    // Aggregate by dynasty slug
    const dynastyMap = new Map<string, { totalJournalists: number; byStatus: Record<string, number> }>();
    for (const row of groupedRows) {
      const rawSlug = row.slug ?? "(none)";
      const dynastySlug = slugToDynasty.get(rawSlug) ?? rawSlug;

      let entry = dynastyMap.get(dynastySlug);
      if (!entry) {
        entry = { totalJournalists: 0, byStatus: {} };
        dynastyMap.set(dynastySlug, entry);
      }
      entry.byStatus[row.status] = (entry.byStatus[row.status] ?? 0) + row.count;
      entry.totalJournalists += row.count;
    }

    // Enrich grouped results with email-gateway stats
    const gwGrouped = await fetchEmailGatewayStatsGrouped(gwParams, groupBy, passthroughHeaders);
    if (gwGrouped) {
      for (const group of gwGrouped.groups) {
        const entry = dynastyMap.get(group.key);
        if (entry && group.broadcast) {
          if (group.broadcast.emailsContacted > 0) entry.byStatus.contacted = group.broadcast.emailsContacted;
          if (group.broadcast.emailsDelivered > 0) entry.byStatus.delivered = group.broadcast.emailsDelivered;
          if (group.broadcast.emailsReplied > 0) entry.byStatus.replied = group.broadcast.emailsReplied;
          if (group.broadcast.emailsBounced > 0) entry.byStatus.bounced = group.broadcast.emailsBounced;
        }
      }
    }

    result.groupedBy = Object.fromEntries(dynastyMap);
  } else if (groupBy === "featureSlug" || groupBy === "workflowSlug") {
    const slugColumn = groupBy === "featureSlug" ? table.featureSlug : table.workflowSlug;

    const groupedRows = await db
      .select({
        slug: slugColumn,
        status: table.status,
        count: count(),
      })
      .from(table)
      .where(where)
      .groupBy(slugColumn, table.status);

    const slugMap = new Map<string, { totalJournalists: number; byStatus: Record<string, number> }>();
    for (const row of groupedRows) {
      const slug = row.slug ?? "(none)";
      let entry = slugMap.get(slug);
      if (!entry) {
        entry = { totalJournalists: 0, byStatus: {} };
        slugMap.set(slug, entry);
      }
      entry.byStatus[row.status] = (entry.byStatus[row.status] ?? 0) + row.count;
      entry.totalJournalists += row.count;
    }

    // Enrich grouped results with email-gateway stats
    const gwGrouped = await fetchEmailGatewayStatsGrouped(gwParams, groupBy, passthroughHeaders);
    if (gwGrouped) {
      for (const group of gwGrouped.groups) {
        const entry = slugMap.get(group.key);
        if (entry && group.broadcast) {
          if (group.broadcast.emailsContacted > 0) entry.byStatus.contacted = group.broadcast.emailsContacted;
          if (group.broadcast.emailsDelivered > 0) entry.byStatus.delivered = group.broadcast.emailsDelivered;
          if (group.broadcast.emailsReplied > 0) entry.byStatus.replied = group.broadcast.emailsReplied;
          if (group.broadcast.emailsBounced > 0) entry.byStatus.bounced = group.broadcast.emailsBounced;
        }
      }
    }

    result.groupedBy = Object.fromEntries(slugMap);
  }

  return result;
}

// ── Private stats: requires identity headers ────────────────────────

router.get("/stats", async (req, res) => {
  try {
    const parsed = StatsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const passthroughHeaders = buildPassthroughHeaders(res.locals);
    const stats = await resolveFiltersAndQuery(parsed.data, passthroughHeaders);
    res.json(stats);
  } catch (err) {
    console.error("[journalists-service] Stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Public stats: only requires API key ─────────────────────────────

router.get("/stats/public", async (req, res) => {
  try {
    const parsed = StatsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const passthroughHeaders = buildPassthroughHeaders(res.locals);
    const stats = await resolveFiltersAndQuery(parsed.data, passthroughHeaders);
    res.json(stats);
  } catch (err) {
    console.error("[journalists-service] Stats/public error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
