import { Router } from "express";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { JournalistsListQuerySchema } from "../schemas.js";
import { checkEmailStatuses, buildStatusBooleans, emptyStatusCounts, accumulateStatus, type EmailGatewayStatusResult, type StatusBooleans, type StatusCounts } from "../lib/email-gateway-client.js";
import { fetchOutletsBatch, type OutletBasic } from "../lib/outlets-client.js";
import { fetchBatchRunCosts, type BatchRunCost } from "../lib/runs-client.js";
import { type OrgContext } from "../lib/service-context.js";

const router = Router();

function buildCtx(locals: Record<string, unknown>): OrgContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string | undefined,
    runId: locals.runId as string | undefined,
    featureSlug: locals.featureSlug as string | undefined,
    campaignId: locals.campaignId as string | undefined,
    brandIds: (locals.brandIds as string[]) || [],
    workflowSlug: locals.workflowSlug as string | undefined,
  };
}

router.get("/orgs/journalists/list", async (req, res) => {
  try {
    const parsed = JournalistsListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { brandId, campaignId, featureSlugs, workflowSlug } = parsed.data;
    const isBrandMode = !campaignId;
    const orgId = res.locals.orgId as string;

    // 1. Query campaign_journalists + journalist details
    const conditions = [
      eq(campaignJournalists.orgId, orgId),
      arrayContains(campaignJournalists.brandIds, [brandId]),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }
    if (featureSlugs && featureSlugs.length > 0) {
      conditions.push(inArray(campaignJournalists.featureSlug, featureSlugs));
    }
    if (workflowSlug) {
      conditions.push(eq(campaignJournalists.workflowSlug, workflowSlug));
    }

    const rows = await db
      .select({
        id: campaignJournalists.id,
        journalistId: campaignJournalists.journalistId,
        campaignId: campaignJournalists.campaignId,
        outletId: campaignJournalists.outletId,
        orgId: campaignJournalists.orgId,
        featureSlug: campaignJournalists.featureSlug,
        workflowSlug: campaignJournalists.workflowSlug,
        relevanceScore: campaignJournalists.relevanceScore,
        whyRelevant: campaignJournalists.whyRelevant,
        whyNotRelevant: campaignJournalists.whyNotRelevant,
        articleUrls: campaignJournalists.articleUrls,
        status: campaignJournalists.status,
        campaignEmail: campaignJournalists.email,
        campaignApolloPersonId: campaignJournalists.apolloPersonId,
        statusReason: campaignJournalists.statusReason,
        statusDetail: campaignJournalists.statusDetail,
        runId: campaignJournalists.runId,
        createdAt: campaignJournalists.createdAt,
        journalistName: journalists.journalistName,
        firstName: journalists.firstName,
        lastName: journalists.lastName,
        entityType: journalists.entityType,
        apolloEmail: journalists.apolloEmail,
        apolloPersonId: journalists.apolloPersonId,
      })
      .from(campaignJournalists)
      .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
      .where(and(...conditions));

    if (rows.length === 0) {
      res.json({ journalists: [], total: 0, byOutreachStatus: {} });
      return;
    }

    // 2. Group rows by journalistId
    const grouped = new Map<string, {
      journalistId: string;
      journalistName: string;
      firstName: string | null;
      lastName: string | null;
      entityType: "individual" | "organization";
      outletId: string;
      apolloEmail: string | null;
      apolloPersonId: string | null;
      campaigns: typeof rows;
    }>();

    for (const row of rows) {
      let group = grouped.get(row.journalistId);
      if (!group) {
        group = {
          journalistId: row.journalistId,
          journalistName: row.journalistName,
          firstName: row.firstName,
          lastName: row.lastName,
          entityType: row.entityType,
          outletId: row.outletId,
          apolloEmail: row.apolloEmail,
          apolloPersonId: row.apolloPersonId,
          campaigns: [],
        };
        grouped.set(row.journalistId, group);
      }
      group.campaigns.push(row);
    }

    // 3. Determine email for each journalist (global apollo_email, fallback to best campaign email)
    const journalistEmails = new Map<string, string>();
    for (const [journalistId, group] of grouped) {
      if (group.apolloEmail) {
        journalistEmails.set(journalistId, group.apolloEmail);
      } else {
        const campaignEmail = group.campaigns.find((c) => c.campaignEmail)?.campaignEmail;
        if (campaignEmail) {
          journalistEmails.set(journalistId, campaignEmail);
        }
      }
    }

    // 4. Enrich with email statuses from email-gateway (fail-open)
    const itemsWithEmail = [...journalistEmails.entries()].map(([, email]) => ({
      email,
    }));

    let emailStatusMap = new Map<string, EmailGatewayStatusResult>();
    if (itemsWithEmail.length > 0) {
      try {
        const ctx = buildCtx({ ...res.locals, brandIds: [brandId] });
        const results = await checkEmailStatuses(
          itemsWithEmail,
          { brandId, campaignId },
          ctx
        );
        for (const result of results) {
          emailStatusMap.set(result.email, result);
        }
      } catch (err) {
        console.warn("[journalists-service] email-gateway enrichment failed (continuing without):", err);
      }
    }

    // 5. Enrich with outlet info from outlets-service (fail-open)
    let outletMap = new Map<string, OutletBasic>();
    const uniqueOutletIds = [...new Set(rows.map((r) => r.outletId))];
    if (uniqueOutletIds.length > 0) {
      try {
        outletMap = await fetchOutletsBatch(uniqueOutletIds);
      } catch (err) {
        console.warn("[journalists-service] outlets-service enrichment failed (continuing without):", err);
      }
    }

    // 6. Enrich with costs from runs-service (fail-open) — aggregate across ALL campaign rows
    const runToJournalists = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.runId) continue;
      let list = runToJournalists.get(row.runId);
      if (!list) {
        list = [];
        runToJournalists.set(row.runId, list);
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

    // 7. Build response — flat merged status per journalist
    const responseCounts = emptyStatusCounts();

    const enrichedJournalists = [...grouped.values()].map((group) => {
      const email = journalistEmails.get(group.journalistId) ?? null;
      const emailStatus = email ? (emailStatusMap.get(email) ?? null) : null;
      const cost = journalistCostMap.get(group.journalistId) ?? null;
      const outlet = outletMap.get(group.outletId);

      // Build scoped status
      let brand: StatusBooleans | null = null;
      let byCampaign: Record<string, StatusBooleans> | null = null;
      let campaign: StatusBooleans | null = null;
      const global = emailStatus
        ? { bounced: emailStatus.broadcast.global.email.bounced, unsubscribed: emailStatus.broadcast.global.email.unsubscribed }
        : null;

      if (isBrandMode) {
        // Brand scope: aggregate across campaigns
        const brandScope = emailStatus?.broadcast.brand ?? null;
        // Use the "best" DB status across all campaigns for the brand-level booleans
        const bestDbStatus = group.campaigns.reduce((best, c) => {
          const order = ["buffered", "claimed", "skipped", "served", "contacted"];
          return order.indexOf(c.status) > order.indexOf(best) ? c.status : best;
        }, "buffered");
        brand = buildStatusBooleans(bestDbStatus, brandScope);
        accumulateStatus(responseCounts, brand);

        // Per-campaign breakdown
        byCampaign = {};
        for (const c of group.campaigns) {
          const campaignScope = emailStatus?.broadcast.byCampaign?.[c.campaignId] ?? null;
          byCampaign[c.campaignId] = buildStatusBooleans(c.status, campaignScope);
        }
      } else {
        // Campaign mode
        const campaignScope = emailStatus?.broadcast.campaign ?? null;
        const bestDbStatus = group.campaigns.reduce((best, c) => {
          const order = ["buffered", "claimed", "skipped", "served", "contacted"];
          return order.indexOf(c.status) > order.indexOf(best) ? c.status : best;
        }, "buffered");
        campaign = buildStatusBooleans(bestDbStatus, campaignScope);
        accumulateStatus(responseCounts, campaign);
      }

      const campaigns = group.campaigns.map((c) => ({
        id: c.id,
        campaignId: c.campaignId,
        featureSlug: c.featureSlug,
        workflowSlug: c.workflowSlug,
        relevanceScore: c.relevanceScore,
        whyRelevant: c.whyRelevant,
        whyNotRelevant: c.whyNotRelevant,
        articleUrls: c.articleUrls,
        email: c.campaignEmail,
        apolloPersonId: c.campaignApolloPersonId,
        statusReason: c.statusReason,
        statusDetail: c.statusDetail,
        runId: c.runId,
        createdAt: c.createdAt,
      }));

      return {
        journalistId: group.journalistId,
        journalistName: group.journalistName,
        firstName: group.firstName,
        lastName: group.lastName,
        entityType: group.entityType,
        outletId: group.outletId,
        outletName: outlet?.outletName ?? null,
        outletDomain: outlet?.outletDomain ?? null,
        email,
        apolloPersonId: group.apolloPersonId,
        brand,
        byCampaign,
        campaign,
        global,
        cost: cost
          ? {
              totalCostInUsdCents: Math.round(cost.totalCostInUsdCents),
              actualCostInUsdCents: Math.round(cost.actualCostInUsdCents),
              provisionedCostInUsdCents: Math.round(cost.provisionedCostInUsdCents),
              runCount: cost.runCount,
            }
          : null,
        campaigns,
      };
    });

    res.json({
      journalists: enrichedJournalists,
      total: enrichedJournalists.length,
      byOutreachStatus: responseCounts,
    });
  } catch (err) {
    console.error("[journalists-service] /journalists/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
