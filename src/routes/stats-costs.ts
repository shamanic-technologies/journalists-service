import { Router } from "express";
import { eq, and, isNotNull, arrayContains } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists } from "../db/schema.js";
import { fetchBatchRunCosts, type BatchRunCost } from "../lib/runs-client.js";
import { type ServiceContext } from "../lib/service-context.js";
import { CostStatsQuerySchema } from "../schemas.js";

const router = Router();

interface CostGroup {
  dimensions: Record<string, string | null>;
  totalCostInUsdCents: number;
  actualCostInUsdCents: number;
  provisionedCostInUsdCents: number;
  runCount: number;
}

function buildCtx(locals: Record<string, unknown>): ServiceContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string,
    runId: locals.runId as string,
    featureSlug: locals.featureSlug as string,
    campaignId: locals.campaignId as string,
    brandIds: locals.brandIds as string[],
    workflowSlug: locals.workflowSlug as string,
  };
}

router.get("/journalists/stats/costs", async (req, res) => {
  try {
    const parsed = CostStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { brandId, campaignId, groupBy } = parsed.data;
    const orgId = res.locals.orgId as string;
    const ctx = buildCtx(res.locals);

    // Query campaign_journalists for this org + brand, only rows with a runId
    const conditions = [
      eq(campaignJournalists.orgId, orgId),
      arrayContains(campaignJournalists.brandIds, [brandId]),
      isNotNull(campaignJournalists.runId),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }

    const rows = await db
      .select({
        id: campaignJournalists.id,
        journalistId: campaignJournalists.journalistId,
        runId: campaignJournalists.runId,
      })
      .from(campaignJournalists)
      .where(and(...conditions));

    if (rows.length === 0) {
      res.json({ groups: [] });
      return;
    }

    // Group journalists by runId and count per run
    const runToJournalists = new Map<string, string[]>();
    for (const row of rows) {
      const runId = row.runId!;
      let list = runToJournalists.get(runId);
      if (!list) {
        list = [];
        runToJournalists.set(runId, list);
      }
      list.push(row.journalistId);
    }

    // Batch fetch costs from runs-service
    const uniqueRunIds = [...runToJournalists.keys()];
    const runCosts = await fetchBatchRunCosts(uniqueRunIds, ctx);

    // Index costs by runId
    const costByRunId = new Map<string, BatchRunCost>();
    for (const rc of runCosts) {
      costByRunId.set(rc.runId, rc);
    }

    if (groupBy === "journalistId") {
      // Distribute run cost evenly across journalists in that run,
      // then aggregate per journalist (a journalist could appear in multiple runs)
      const journalistAgg = new Map<
        string,
        { total: number; actual: number; provisioned: number; runs: Set<string> }
      >();

      for (const [runId, journalistIds] of runToJournalists) {
        const cost = costByRunId.get(runId);
        if (!cost) continue;

        const count = journalistIds.length;
        const shareTotalCents = Number(cost.totalCostInUsdCents) / count;
        const shareActualCents = Number(cost.actualCostInUsdCents) / count;
        const shareProvisionedCents =
          Number(cost.provisionedCostInUsdCents) / count;

        for (const jId of journalistIds) {
          let agg = journalistAgg.get(jId);
          if (!agg) {
            agg = { total: 0, actual: 0, provisioned: 0, runs: new Set() };
            journalistAgg.set(jId, agg);
          }
          agg.total += shareTotalCents;
          agg.actual += shareActualCents;
          agg.provisioned += shareProvisionedCents;
          agg.runs.add(runId);
        }
      }

      const groups: CostGroup[] = [];
      for (const [journalistId, agg] of journalistAgg) {
        groups.push({
          dimensions: { journalistId },
          totalCostInUsdCents: Math.round(agg.total),
          actualCostInUsdCents: Math.round(agg.actual),
          provisionedCostInUsdCents: Math.round(agg.provisioned),
          runCount: agg.runs.size,
        });
      }

      res.json({ groups });
    } else {
      // No groupBy — return flat totals across all runs
      let totalCost = 0;
      let actualCost = 0;
      let provisionedCost = 0;
      let runCount = 0;

      for (const rc of runCosts) {
        totalCost += Number(rc.totalCostInUsdCents);
        actualCost += Number(rc.actualCostInUsdCents);
        provisionedCost += Number(rc.provisionedCostInUsdCents);
        runCount++;
      }

      const groups: CostGroup[] = [
        {
          dimensions: {},
          totalCostInUsdCents: Math.round(totalCost),
          actualCostInUsdCents: Math.round(actualCost),
          provisionedCostInUsdCents: Math.round(provisionedCost),
          runCount,
        },
      ];

      res.json({ groups });
    }
  } catch (err) {
    console.error("[journalists-service] Stats/costs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
