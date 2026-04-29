import { Router } from "express";
import { eq, and, inArray, arrayContains, count, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { StatsQuerySchema } from "../schemas.js";
import {
  fetchEmailGatewayStats,
  fetchEmailGatewayStatsGrouped,
  checkEmailStatuses,
  makeCumulativeDbCounts,
  type EmailGatewayStatsParams,
  type EmailGatewayBroadcastStats,
  type EmailGatewayRepliesDetail,
  type EmailScopeStatus,
} from "../lib/email-gateway-client.js";
import { type OrgContext } from "../lib/service-context.js";
import { resolveWorkflowDynastySlugs, fetchWorkflowDynastyMap } from "../lib/dynasty-client.js";

export const publicStatsRouter = Router();
export const orgStatsRouter = Router();

// ── Shared stats logic ──────────────────────────────────────────────

interface GroupedEntry {
  totalJournalists: number;
  byOutreachStatus: Record<string, number>;
  repliesDetail?: EmailGatewayRepliesDetail;
}

interface StatsResult {
  totalJournalists: number;
  byOutreachStatus: Record<string, number>;
  repliesDetail?: EmailGatewayRepliesDetail;
  groupedBy?: Record<string, GroupedEntry>;
}

function emptyStats(): StatsResult {
  return { totalJournalists: 0, byOutreachStatus: {} };
}

function enrichWithGatewayStats(target: Record<string, number>, gw: EmailGatewayBroadcastStats): void {
  const rs = gw.recipientStats;
  if (rs.contacted > 0) target.contacted = rs.contacted;
  if (rs.sent > 0) target.sent = rs.sent;
  if (rs.delivered > 0) target.delivered = rs.delivered;
  if (rs.opened > 0) target.opened = rs.opened;
  if (rs.clicked > 0) target.clicked = rs.clicked;
  if (rs.bounced > 0) target.bounced = rs.bounced;
  if (rs.unsubscribed > 0) target.unsubscribed = rs.unsubscribed;
  if (rs.repliesPositive > 0) target.repliesPositive = rs.repliesPositive;
  if (rs.repliesNegative > 0) target.repliesNegative = rs.repliesNegative;
  if (rs.repliesNeutral > 0) target.repliesNeutral = rs.repliesNeutral;
  if (rs.repliesAutoReply > 0) target.repliesAutoReply = rs.repliesAutoReply;
}

/**
 * When outletId is present, the aggregate email-gateway stats endpoint can't filter by outlet.
 * Instead, resolve per-email statuses and count the booleans.
 */
async function enrichWithPerEmailStats(
  target: Record<string, number>,
  where: ReturnType<typeof and>,
  query: { campaignId?: string; brandId?: string },
  passthroughHeaders: Record<string, string>,
): Promise<void> {
  try {
    const emailRows = await db
      .select({
        apolloEmail: journalists.apolloEmail,
        campaignEmail: campaignJournalists.email,
      })
      .from(campaignJournalists)
      .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
      .where(where);

    const uniqueEmails = [
      ...new Set(
        emailRows
          .map((r) => r.apolloEmail ?? r.campaignEmail)
          .filter((e): e is string => e !== null)
      ),
    ];
    if (uniqueEmails.length === 0) return;

    const ctx: OrgContext = {
      orgId: passthroughHeaders["x-org-id"] ?? "",
      userId: passthroughHeaders["x-user-id"],
      runId: passthroughHeaders["x-run-id"],
      brandIds: query.brandId ? [query.brandId] : [],
    };

    const results = await checkEmailStatuses(
      uniqueEmails.map((email) => ({ email })),
      { brandId: query.brandId, campaignId: query.campaignId },
      ctx,
    );

    for (const r of results) {
      const scope: EmailScopeStatus | null =
        r.broadcast.campaign ?? r.broadcast.brand ?? null;
      if (!scope) continue;
      if (scope.contacted) target.contacted = (target.contacted ?? 0) + 1;
      if (scope.sent) target.sent = (target.sent ?? 0) + 1;
      if (scope.delivered) target.delivered = (target.delivered ?? 0) + 1;
      if (scope.opened) target.opened = (target.opened ?? 0) + 1;
      if (scope.clicked) target.clicked = (target.clicked ?? 0) + 1;
      if (scope.bounced) target.bounced = (target.bounced ?? 0) + 1;
      if (scope.unsubscribed) target.unsubscribed = (target.unsubscribed ?? 0) + 1;
      if (scope.replied) {
        if (scope.replyClassification === "positive") target.repliesPositive = (target.repliesPositive ?? 0) + 1;
        if (scope.replyClassification === "negative") target.repliesNegative = (target.repliesNegative ?? 0) + 1;
        if (scope.replyClassification === "neutral") target.repliesNeutral = (target.repliesNeutral ?? 0) + 1;
      }
    }
  } catch (err) {
    console.warn("[journalists-service] per-email stats enrichment failed (continuing without):", err);
  }
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

  // Resolve dynasty slug to versioned workflow slugs (if provided)
  const dynastyContext = {
    orgId: passthroughHeaders["x-org-id"],
    userId: passthroughHeaders["x-user-id"],
    runId: passthroughHeaders["x-run-id"],
  };

  let resolvedWorkflowSlugs: string[] | undefined;
  if (query.workflowDynastySlug) {
    resolvedWorkflowSlugs = await resolveWorkflowDynastySlugs(query.workflowDynastySlug, dynastyContext);
    if (resolvedWorkflowSlugs.length === 0) return emptyStats();
  }

  // Build WHERE conditions
  const conditions = [];

  if (query.orgId) conditions.push(eq(table.orgId, query.orgId));
  if (query.campaignId) conditions.push(eq(table.campaignId, query.campaignId));
  if (query.outletId) conditions.push(eq(table.outletId, query.outletId));
  if (query.brandId) conditions.push(arrayContains(table.brandIds, [query.brandId]));

  if (query.featureSlugs && query.featureSlugs.length > 0) {
    conditions.push(inArray(table.featureSlug, query.featureSlugs));
  } else if (query.featureSlug) {
    conditions.push(eq(table.featureSlug, query.featureSlug));
  }

  if (resolvedWorkflowSlugs) {
    conditions.push(inArray(table.workflowSlug, resolvedWorkflowSlugs));
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

  // Build exclusive DB counts, then convert to cumulative
  const exclusiveCounts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    exclusiveCounts[row.status] = row.count;
    total += row.count;
  }
  const byOutreachStatus: Record<string, number> = makeCumulativeDbCounts(exclusiveCounts);

  // Enrich with email-gateway stats (fail-open)
  const gwParams: EmailGatewayStatsParams = {
    campaignId: query.campaignId,
    brandId: query.brandId,
    featureSlug: query.featureSlug,
    featureSlugs: query.featureSlugs,
    workflowSlug: query.workflowSlug,
  };

  const result: StatsResult = { totalJournalists: total, byOutreachStatus };

  if (query.outletId) {
    // Outlet-scoped: aggregate stats endpoint doesn't support outletId filtering,
    // so resolve per-email via POST /orgs/status and count booleans.
    await enrichWithPerEmailStats(byOutreachStatus, where, query, passthroughHeaders);
  } else {
    const gwStats = await fetchEmailGatewayStats(gwParams, passthroughHeaders);
    if (gwStats) {
      enrichWithGatewayStats(byOutreachStatus, gwStats);
      if (gwStats.recipientStats.repliesDetail) result.repliesDetail = gwStats.recipientStats.repliesDetail;
    }
  }

  const groupBy = query.groupBy;
  if (groupBy === "featureSlug" || groupBy === "workflowSlug") {
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

    const slugMap = new Map<string, GroupedEntry>();
    for (const row of groupedRows) {
      const slug = row.slug ?? "(none)";
      let entry = slugMap.get(slug);
      if (!entry) {
        entry = { totalJournalists: 0, byOutreachStatus: {} };
        slugMap.set(slug, entry);
      }
      entry.byOutreachStatus[row.status] = (entry.byOutreachStatus[row.status] ?? 0) + row.count;
      entry.totalJournalists += row.count;
    }

    // Make slug DB counts cumulative
    for (const entry of slugMap.values()) {
      const cumulative = makeCumulativeDbCounts(entry.byOutreachStatus);
      entry.byOutreachStatus = cumulative;
    }

    // Enrich grouped results with email-gateway stats
    const gwGrouped = await fetchEmailGatewayStatsGrouped(gwParams, groupBy, passthroughHeaders);
    if (gwGrouped) {
      for (const group of gwGrouped.groups) {
        const entry = slugMap.get(group.key);
        if (entry && group.broadcast) {
          enrichWithGatewayStats(entry.byOutreachStatus, group.broadcast);
          if (group.broadcast.recipientStats.repliesDetail) entry.repliesDetail = group.broadcast.recipientStats.repliesDetail;
        }
      }
    }

    result.groupedBy = Object.fromEntries(slugMap);
  } else if (groupBy === "workflowDynastySlug") {
    // Query by workflow_slug, then re-aggregate by dynasty via reverse map
    const [dynastyMap, groupedRows] = await Promise.all([
      fetchWorkflowDynastyMap(dynastyContext),
      db
        .select({
          slug: table.workflowSlug,
          status: table.status,
          count: count(),
        })
        .from(table)
        .where(where)
        .groupBy(table.workflowSlug, table.status),
    ]);

    const toDynasty = (slug: string | null): string =>
      dynastyMap.get(slug ?? "") ?? slug ?? "(none)";

    const dynastyGroupMap = new Map<string, GroupedEntry>();
    for (const row of groupedRows) {
      const dynastyKey = toDynasty(row.slug);
      let entry = dynastyGroupMap.get(dynastyKey);
      if (!entry) {
        entry = { totalJournalists: 0, byOutreachStatus: {} };
        dynastyGroupMap.set(dynastyKey, entry);
      }
      entry.byOutreachStatus[row.status] = (entry.byOutreachStatus[row.status] ?? 0) + row.count;
      entry.totalJournalists += row.count;
    }

    for (const entry of dynastyGroupMap.values()) {
      entry.byOutreachStatus = makeCumulativeDbCounts(entry.byOutreachStatus);
    }

    // Enrich with email-gateway stats grouped by workflowSlug, then re-aggregate by dynasty
    const gwGrouped = await fetchEmailGatewayStatsGrouped(gwParams, "workflowSlug", passthroughHeaders);
    if (gwGrouped) {
      for (const group of gwGrouped.groups) {
        const dynastyKey = toDynasty(group.key);
        const entry = dynastyGroupMap.get(dynastyKey);
        if (entry && group.broadcast) {
          enrichWithGatewayStats(entry.byOutreachStatus, group.broadcast);
          if (group.broadcast.recipientStats.repliesDetail) entry.repliesDetail = group.broadcast.recipientStats.repliesDetail;
        }
      }
    }

    result.groupedBy = Object.fromEntries(dynastyGroupMap);
  } else if (groupBy === "campaignId") {
    const groupedRows = await db
      .select({
        slug: table.campaignId,
        status: table.status,
        count: count(),
      })
      .from(table)
      .where(where)
      .groupBy(table.campaignId, table.status);

    const campaignMap = new Map<string, GroupedEntry>();
    for (const row of groupedRows) {
      const campaignId = row.slug ?? "(none)";
      let entry = campaignMap.get(campaignId);
      if (!entry) {
        entry = { totalJournalists: 0, byOutreachStatus: {} };
        campaignMap.set(campaignId, entry);
      }
      entry.byOutreachStatus[row.status] = (entry.byOutreachStatus[row.status] ?? 0) + row.count;
      entry.totalJournalists += row.count;
    }

    // Make campaign DB counts cumulative
    for (const entry of campaignMap.values()) {
      const cumulative = makeCumulativeDbCounts(entry.byOutreachStatus);
      entry.byOutreachStatus = cumulative;
    }

    // Enrich grouped results with email-gateway stats
    const gwGrouped = await fetchEmailGatewayStatsGrouped(gwParams, "campaignId", passthroughHeaders);
    if (gwGrouped) {
      for (const group of gwGrouped.groups) {
        const entry = campaignMap.get(group.key);
        if (entry && group.broadcast) {
          enrichWithGatewayStats(entry.byOutreachStatus, group.broadcast);
          if (group.broadcast.recipientStats.repliesDetail) entry.repliesDetail = group.broadcast.recipientStats.repliesDetail;
        }
      }
    }

    result.groupedBy = Object.fromEntries(campaignMap);
  } else if (groupBy === "brandId") {
    // brand_ids is a UUID array — UNNEST to get per-brand rows
    // A journalist with [brandA, brandB] will appear in both groups
    const groupedRows = await db.execute<{ brand_id: string; status: string; cnt: number }>(
      sql`
        SELECT unnested_brand AS brand_id, status, COUNT(*)::int AS cnt
        FROM ${table}, UNNEST(${table.brandIds}) AS unnested_brand
        WHERE ${where ?? sql`TRUE`}
        GROUP BY unnested_brand, status
      `
    );

    const brandMap = new Map<string, GroupedEntry>();
    for (const row of groupedRows) {
      const brandId = row.brand_id;
      let entry = brandMap.get(brandId);
      if (!entry) {
        entry = { totalJournalists: 0, byOutreachStatus: {} };
        brandMap.set(brandId, entry);
      }
      entry.byOutreachStatus[row.status] = (entry.byOutreachStatus[row.status] ?? 0) + row.cnt;
      entry.totalJournalists += row.cnt;
    }

    // Make brand DB counts cumulative
    for (const entry of brandMap.values()) {
      const cumulative = makeCumulativeDbCounts(entry.byOutreachStatus);
      entry.byOutreachStatus = cumulative;
    }

    // Enrich grouped results with email-gateway stats
    const gwGrouped = await fetchEmailGatewayStatsGrouped(gwParams, "brandId", passthroughHeaders);
    if (gwGrouped) {
      for (const group of gwGrouped.groups) {
        const entry = brandMap.get(group.key);
        if (entry && group.broadcast) {
          enrichWithGatewayStats(entry.byOutreachStatus, group.broadcast);
          if (group.broadcast.recipientStats.repliesDetail) entry.repliesDetail = group.broadcast.recipientStats.repliesDetail;
        }
      }
    }

    result.groupedBy = Object.fromEntries(brandMap);
  }

  return result;
}

// ── Org-scoped stats: requires x-org-id ─────────────────────────────

orgStatsRouter.get("/orgs/stats", async (req, res) => {
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

// ─��� Protected public stats: only requires API key ───────────────────

publicStatsRouter.get("/public/stats", async (req, res) => {
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

// default export kept for backwards compat in tests (exports both routers merged)
const router = Router();
router.use(publicStatsRouter);
router.use(orgStatsRouter);
export default router;
