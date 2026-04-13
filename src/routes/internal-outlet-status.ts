import { Router } from "express";
import { inArray, and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { checkEmailStatuses, buildStatusBooleans, emptyStatusCounts, accumulateStatus, type EmailGatewayStatusResult, type StatusCounts } from "../lib/email-gateway-client.js";
import { type OrgContext } from "../lib/service-context.js";
import { OutletStatusRequestSchema } from "../schemas.js";

const router = Router();

// POST /orgs/outlets/status — batch enriched outreach status from email-gateway
// Scoping is determined by scopeFilters in the body, not headers.

router.post("/orgs/outlets/status", async (req, res) => {
  const parsed = OutletStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { outletIds, scopeFilters } = parsed.data;

  if (!scopeFilters.brandId && !scopeFilters.campaignId) {
    res.status(400).json({ error: "scopeFilters.brandId or scopeFilters.campaignId is required" });
    return;
  }

  const orgId = res.locals.orgId as string;
  const brandId = scopeFilters.brandId;
  const campaignId = scopeFilters.campaignId;

  try {
    // 1. Get all campaign_journalists for these outlets, scoped by org + scopeFilters
    const conditions = [
      inArray(campaignJournalists.outletId, outletIds),
      eq(campaignJournalists.orgId, orgId),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }
    if (brandId) {
      const pgArray = `{${brandId}}`;
      conditions.push(sql`${campaignJournalists.brandIds} && ${pgArray}::uuid[]`);
    }

    const rows = await db
      .select({
        cjId: campaignJournalists.id,
        outletId: campaignJournalists.outletId,
        journalistId: campaignJournalists.journalistId,
        campaignId: campaignJournalists.campaignId,
        status: campaignJournalists.status,
        email: campaignJournalists.email,
        apolloEmail: journalists.apolloEmail,
      })
      .from(campaignJournalists)
      .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
      .where(and(...conditions));

    // Group by outlet
    const byOutlet = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byOutlet.get(row.outletId) ?? [];
      list.push(row);
      byOutlet.set(row.outletId, list);
    }

    // 2. Collect all journalists with emails for email-gateway batch call
    const resolvedEmails = new Map<string, string>(); // cjId → email
    const emailItems: Array<{ email: string }> = [];
    const seenEmails = new Set<string>();
    for (const row of rows) {
      const email = row.apolloEmail ?? row.email;
      if (email) {
        resolvedEmails.set(row.cjId, email);
        if (!seenEmails.has(email)) {
          seenEmails.add(email);
          emailItems.push({ email });
        }
      }
    }

    // 3. Call email-gateway for real-time statuses
    const emailStatusMap = new Map<string, EmailGatewayStatusResult>();
    if (emailItems.length > 0) {
      const ctx: OrgContext = {
        orgId,
        userId: res.locals.userId as string | undefined,
        runId: res.locals.runId as string | undefined,
        campaignId: res.locals.campaignId as string | undefined,
        brandIds: (res.locals.brandIds as string[]) || [],
        featureSlug: res.locals.featureSlug as string | undefined,
        workflowSlug: res.locals.workflowSlug as string | undefined,
      };

      const gatewayResults = await checkEmailStatuses(
        emailItems,
        { brandId, campaignId },
        ctx
      );

      for (const result of gatewayResults) {
        emailStatusMap.set(result.email, result);
      }
    }

    // 4. Build results per outlet with counts
    const isBrandMode = !!brandId && !campaignId;
    const totalCounts = emptyStatusCounts();

    type OutletResult = {
      totalJournalists: number;
      brand: StatusCounts | null;
      byCampaign: Record<string, StatusCounts> | null;
      campaign: StatusCounts | null;
      global: { bounced: number; unsubscribed: number };
    };

    const results: Record<string, OutletResult> = {};

    for (const outletId of outletIds) {
      const outletRows = byOutlet.get(outletId) ?? [];
      const outletBrandCounts = emptyStatusCounts();
      const outletCampaignCounts = emptyStatusCounts();
      const campaignCountsMap = new Map<string, StatusCounts>();
      let globalBounced = 0;
      let globalUnsubscribed = 0;

      for (const row of outletRows) {
        const resolvedEmail = resolvedEmails.get(row.cjId);
        const egResult = resolvedEmail ? (emailStatusMap.get(resolvedEmail) ?? null) : null;

        if (egResult) {
          if (egResult.broadcast.global.email.bounced) globalBounced++;
          if (egResult.broadcast.global.email.unsubscribed) globalUnsubscribed++;
        }

        if (isBrandMode) {
          // Brand-level counts
          const brandScope = egResult?.broadcast.brand ?? null;
          const brandStatus = buildStatusBooleans(row.status, brandScope);
          accumulateStatus(outletBrandCounts, brandStatus);
          accumulateStatus(totalCounts, brandStatus);

          // Per-campaign counts
          const campaignScope = egResult?.broadcast.byCampaign?.[row.campaignId] ?? null;
          const campaignStatus = buildStatusBooleans(row.status, campaignScope);
          let campCounts = campaignCountsMap.get(row.campaignId);
          if (!campCounts) {
            campCounts = emptyStatusCounts();
            campaignCountsMap.set(row.campaignId, campCounts);
          }
          accumulateStatus(campCounts, campaignStatus);
        } else {
          // Campaign mode
          const campaignScope = egResult?.broadcast.campaign ?? null;
          const campaignStatus = buildStatusBooleans(row.status, campaignScope);
          accumulateStatus(outletCampaignCounts, campaignStatus);
          accumulateStatus(totalCounts, campaignStatus);
        }
      }

      const entry: OutletResult = {
        totalJournalists: outletRows.length,
        brand: isBrandMode ? outletBrandCounts : null,
        byCampaign: isBrandMode ? Object.fromEntries(campaignCountsMap) : null,
        campaign: isBrandMode ? null : outletCampaignCounts,
        global: { bounced: globalBounced, unsubscribed: globalUnsubscribed },
      };

      results[outletId] = entry;
    }

    res.json({
      results,
      total: rows.length,
      byOutreachStatus: totalCounts,
    });
  } catch (err) {
    console.error("[journalists-service] /orgs/outlets/status error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
