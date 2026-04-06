import { Router } from "express";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { JournalistsListQuerySchema } from "../schemas.js";
import { checkEmailStatuses, consolidateStatus, type EmailGatewayStatusResult } from "../lib/email-gateway-client.js";
import { fetchBatchRunCosts, type BatchRunCost } from "../lib/runs-client.js";
import { resolveFeatureDynastySlugs } from "../lib/dynasty-client.js";
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

    const { brandId, campaignId, featureSlugs, featureDynastySlug, workflowSlug } = parsed.data;
    const orgId = res.locals.orgId as string;

    // 1. Resolve dynasty slug to versioned slugs (if provided)
    const passthroughHeaders: Record<string, string> = {};
    if (res.locals.orgId) passthroughHeaders["x-org-id"] = res.locals.orgId as string;
    if (res.locals.userId) passthroughHeaders["x-user-id"] = res.locals.userId as string;
    if (res.locals.runId) passthroughHeaders["x-run-id"] = res.locals.runId as string;

    let resolvedFeatureSlugs: string[] | undefined = featureSlugs;
    if (featureDynastySlug) {
      const dynastySlugs = await resolveFeatureDynastySlugs(featureDynastySlug, passthroughHeaders);
      if (dynastySlugs.length === 0) {
        res.json({ journalists: [] });
        return;
      }
      resolvedFeatureSlugs = dynastySlugs;
    }

    // 2. Query campaign_journalists + journalist details
    const conditions = [
      eq(campaignJournalists.orgId, orgId),
      arrayContains(campaignJournalists.brandIds, [brandId]),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }
    if (resolvedFeatureSlugs && resolvedFeatureSlugs.length > 0) {
      conditions.push(inArray(campaignJournalists.featureSlug, resolvedFeatureSlugs));
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
      res.json({ journalists: [] });
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
    const itemsWithEmail = [...journalistEmails.entries()].map(([leadId, email]) => ({
      leadId,
      email,
    }));

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

    // 5. Enrich with costs from runs-service (fail-open) — aggregate across ALL campaign rows
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

    // 6. Build response
    const enrichedJournalists = [...grouped.values()].map((group) => {
      const emailStatus = emailStatusMap.get(group.journalistId) ?? null;
      const cost = journalistCostMap.get(group.journalistId) ?? null;
      const email = journalistEmails.get(group.journalistId) ?? null;

      return {
        journalistId: group.journalistId,
        journalistName: group.journalistName,
        firstName: group.firstName,
        lastName: group.lastName,
        entityType: group.entityType,
        outletId: group.outletId,
        email,
        apolloPersonId: group.apolloPersonId,
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
        campaigns: group.campaigns.map((c) => {
          const statusTriplet = consolidateStatus(c.status, emailStatus);
          return {
            id: c.id,
            campaignId: c.campaignId,
            featureSlug: c.featureSlug,
            workflowSlug: c.workflowSlug,
            consolidatedStatus: statusTriplet.consolidatedStatus,
            localStatus: statusTriplet.localStatus,
            emailGatewayStatus: statusTriplet.emailGatewayStatus,
            relevanceScore: c.relevanceScore,
            whyRelevant: c.whyRelevant,
            whyNotRelevant: c.whyNotRelevant,
            articleUrls: c.articleUrls,
            email: c.campaignEmail,
            apolloPersonId: c.campaignApolloPersonId,
            runId: c.runId,
            createdAt: c.createdAt,
          };
        }),
      };
    });

    res.json({ journalists: enrichedJournalists });
  } catch (err) {
    console.error("[journalists-service] /journalists/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
