import { Router } from "express";
import { and, arrayContains, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { JournalistsListQuerySchema } from "../schemas.js";
import { checkEmailStatuses, type EmailGatewayStatusResult } from "../lib/email-gateway-client.js";
import { fetchBatchRunCosts, type BatchRunCost } from "../lib/runs-client.js";
import { type ServiceContext } from "../lib/service-context.js";

const router = Router();

// Status priority for dedup: prefer the most "advanced" status
const STATUS_PRIORITY: Record<string, number> = {
  contacted: 1,
  served: 2,
  claimed: 3,
  buffered: 4,
  skipped: 5,
};

type JournalistRow = {
  id: string;
  journalistId: string;
  campaignId: string;
  outletId: string;
  orgId: string;
  brandIds: string[];
  featureSlug: string | null;
  workflowSlug: string | null;
  relevanceScore: string;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: string[] | null;
  status: "buffered" | "claimed" | "served" | "contacted" | "skipped";
  email: string | null;
  runId: string | null;
  createdAt: Date;
  journalistName: string;
  firstName: string | null;
  lastName: string | null;
  entityType: "individual" | "organization";
};

/**
 * Deduplicate rows by journalist_id: keep the "best" row per journalist.
 * Priority: status (contacted > served > claimed > buffered > skipped),
 * then has email, then most recent.
 */
function deduplicateByJournalist(rows: JournalistRow[]): JournalistRow[] {
  const byJournalist = new Map<string, JournalistRow>();

  for (const row of rows) {
    const existing = byJournalist.get(row.journalistId);
    if (!existing) {
      byJournalist.set(row.journalistId, row);
      continue;
    }

    const existingPriority = STATUS_PRIORITY[existing.status] ?? 99;
    const rowPriority = STATUS_PRIORITY[row.status] ?? 99;

    // Better status wins
    if (rowPriority < existingPriority) {
      byJournalist.set(row.journalistId, row);
      continue;
    }
    if (rowPriority > existingPriority) continue;

    // Same status: prefer row with email
    if (row.email && !existing.email) {
      byJournalist.set(row.journalistId, row);
      continue;
    }
    if (!row.email && existing.email) continue;

    // Same status, same email presence: prefer most recent
    if (new Date(row.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      byJournalist.set(row.journalistId, row);
    }
  }

  return Array.from(byJournalist.values());
}

function buildCtx(locals: Record<string, unknown>): ServiceContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string,
    runId: locals.runId as string,
    featureSlug: (locals.featureSlug as string) || "",
    campaignId: (locals.campaignId as string) || "",
    brandIds: (locals.brandIds as string[]) || [],
    workflowSlug: (locals.workflowSlug as string) || "",
  };
}

router.get("/journalists/list", async (req, res) => {
  try {
    const parsed = JournalistsListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { brandId, campaignId } = parsed.data;
    const orgId = res.locals.orgId as string;

    // 1. Query campaign_journalists + journalist details
    const conditions = [
      eq(campaignJournalists.orgId, orgId),
      arrayContains(campaignJournalists.brandIds, [brandId]),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }

    const rows = await db
      .select({
        id: campaignJournalists.id,
        journalistId: campaignJournalists.journalistId,
        campaignId: campaignJournalists.campaignId,
        outletId: campaignJournalists.outletId,
        orgId: campaignJournalists.orgId,
        brandIds: campaignJournalists.brandIds,
        featureSlug: campaignJournalists.featureSlug,
        workflowSlug: campaignJournalists.workflowSlug,
        relevanceScore: campaignJournalists.relevanceScore,
        whyRelevant: campaignJournalists.whyRelevant,
        whyNotRelevant: campaignJournalists.whyNotRelevant,
        articleUrls: campaignJournalists.articleUrls,
        status: campaignJournalists.status,
        email: campaignJournalists.email,
        runId: campaignJournalists.runId,
        createdAt: campaignJournalists.createdAt,
        journalistName: journalists.journalistName,
        firstName: journalists.firstName,
        lastName: journalists.lastName,
        entityType: journalists.entityType,
      })
      .from(campaignJournalists)
      .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
      .where(and(...conditions));

    if (rows.length === 0) {
      res.json({ journalists: [] });
      return;
    }

    // When querying across campaigns (no campaignId filter), deduplicate by journalist_id.
    // Pick the "best" row per journalist: prefer contacted > served > claimed > buffered > skipped,
    // then prefer rows with email, then most recent.
    const deduped = campaignId ? rows : deduplicateByJournalist(rows);

    // 2. Enrich with email statuses from email-gateway (fail-open)
    const itemsWithEmail = deduped
      .filter((r) => r.email)
      .map((r) => ({ leadId: r.journalistId, email: r.email! }));

    let emailStatusMap = new Map<string, EmailGatewayStatusResult>();
    if (itemsWithEmail.length > 0) {
      try {
        const ctx = buildCtx({ ...res.locals, brandIds: [brandId] });
        const results = await checkEmailStatuses(itemsWithEmail, campaignId, ctx);
        for (const result of results) {
          emailStatusMap.set(result.leadId, result);
        }
      } catch (err) {
        console.warn("[journalists-service] email-gateway enrichment failed (continuing without):", err);
      }
    }

    // 3. Enrich with costs from runs-service (fail-open)
    const rowsWithRunId = deduped.filter((r) => r.runId);
    const runToJournalists = new Map<string, string[]>();
    for (const row of rowsWithRunId) {
      const runId = row.runId!;
      let list = runToJournalists.get(runId);
      if (!list) {
        list = [];
        runToJournalists.set(runId, list);
      }
      list.push(row.journalistId);
    }

    const journalistCostMap = new Map<string, { totalCostInUsdCents: number; actualCostInUsdCents: number; provisionedCostInUsdCents: number; runCount: number }>();
    if (runToJournalists.size > 0) {
      try {
        const ctx = buildCtx(res.locals);
        const runCosts = await fetchBatchRunCosts([...runToJournalists.keys()], ctx);
        const costByRunId = new Map<string, BatchRunCost>();
        for (const rc of runCosts) {
          costByRunId.set(rc.runId, rc);
        }

        for (const [runId, journalistIds] of runToJournalists) {
          const cost = costByRunId.get(runId);
          if (!cost) continue;

          const count = journalistIds.length;
          const shareTotalCents = Number(cost.totalCostInUsdCents) / count;
          const shareActualCents = Number(cost.actualCostInUsdCents) / count;
          const shareProvisionedCents = Number(cost.provisionedCostInUsdCents) / count;

          for (const jId of journalistIds) {
            let agg = journalistCostMap.get(jId);
            if (!agg) {
              agg = { totalCostInUsdCents: 0, actualCostInUsdCents: 0, provisionedCostInUsdCents: 0, runCount: 0 };
              journalistCostMap.set(jId, agg);
            }
            agg.totalCostInUsdCents += shareTotalCents;
            agg.actualCostInUsdCents += shareActualCents;
            agg.provisionedCostInUsdCents += shareProvisionedCents;
            agg.runCount++;
          }
        }
      } catch (err) {
        console.warn("[journalists-service] runs-service cost enrichment failed (continuing without):", err);
      }
    }

    // 4. Build response
    const enrichedJournalists = deduped.map((row) => {
      const emailStatus = emailStatusMap.get(row.journalistId) ?? null;
      const cost = journalistCostMap.get(row.journalistId) ?? null;

      return {
        id: row.id,
        journalistId: row.journalistId,
        campaignId: row.campaignId,
        outletId: row.outletId,
        orgId: row.orgId,
        brandIds: row.brandIds,
        featureSlug: row.featureSlug,
        workflowSlug: row.workflowSlug,
        relevanceScore: row.relevanceScore,
        whyRelevant: row.whyRelevant,
        whyNotRelevant: row.whyNotRelevant,
        articleUrls: row.articleUrls,
        status: row.status,
        email: row.email,
        runId: row.runId,
        createdAt: row.createdAt,
        journalistName: row.journalistName,
        firstName: row.firstName,
        lastName: row.lastName,
        entityType: row.entityType,
        emailStatus: emailStatus
          ? {
              broadcast: emailStatus.broadcast,
              transactional: emailStatus.transactional,
            }
          : null,
        cost: cost
          ? {
              totalCostInUsdCents: Math.round(cost.totalCostInUsdCents),
              actualCostInUsdCents: Math.round(cost.actualCostInUsdCents),
              provisionedCostInUsdCents: Math.round(cost.provisionedCostInUsdCents),
              runCount: cost.runCount,
            }
          : null,
      };
    });

    res.json({ journalists: enrichedJournalists });
  } catch (err) {
    console.error("[journalists-service] /journalists/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
