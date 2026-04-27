import { Router } from "express";
import { eq, and, arrayContains, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { checkEmailStatuses, buildStatusBooleans, type EmailGatewayStatusResult } from "../lib/email-gateway-client.js";
import { type OrgContext } from "../lib/service-context.js";

const router = Router();

const querySchema = z.object({
  campaign_id: z.string().uuid().optional(),
  brand_id: z.string().uuid().optional(),
  outlet_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  feature_slug: z.string().optional(),
});

// GET /campaign-outlet-journalists?campaign_id=...&outlet_id=...&run_id=...
// GET /campaign-outlet-journalists?brand_id=...&outlet_id=...
// GET /campaign-outlet-journalists?brand_id=...&feature_slug=pr-cold-email-outreach
router.get("/orgs/campaign-outlet-journalists", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "campaign_id or brand_id (uuid) is required" });
    return;
  }

  const { campaign_id, brand_id, outlet_id, run_id, feature_slug } = parsed.data;

  if (!campaign_id && !brand_id) {
    res.status(400).json({ error: "campaign_id or brand_id (uuid) is required" });
    return;
  }

  const conditions: ReturnType<typeof eq>[] = [];
  if (campaign_id) {
    conditions.push(eq(campaignJournalists.campaignId, campaign_id));
  }
  if (brand_id) {
    conditions.push(arrayContains(campaignJournalists.brandIds, [brand_id]));
  }
  if (outlet_id) {
    conditions.push(eq(campaignJournalists.outletId, outlet_id));
  }
  if (run_id) {
    conditions.push(eq(campaignJournalists.runId, run_id));
  }
  if (feature_slug) {
    conditions.push(eq(campaignJournalists.featureSlug, feature_slug));
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
      apolloEmail: journalists.apolloEmail,
    })
    .from(campaignJournalists)
    .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
    .where(and(...conditions));

  if (rows.length === 0) {
    res.json({ campaignJournalists: [] });
    return;
  }

  // Enrich with email-gateway statuses (fail-open)
  const itemsWithEmail: Array<{ email: string }> = [];
  for (const row of rows) {
    const email = row.apolloEmail ?? row.email;
    if (email) {
      itemsWithEmail.push({ email });
    }
  }

  let emailStatusMap = new Map<string, EmailGatewayStatusResult>();
  if (itemsWithEmail.length > 0 && (brand_id || campaign_id)) {
    try {
      const ctx: OrgContext = {
        orgId: res.locals.orgId as string,
        userId: res.locals.userId as string | undefined,
        runId: res.locals.runId as string | undefined,
        featureSlug: res.locals.featureSlug as string | undefined,
        campaignId: res.locals.campaignId as string | undefined,
        brandIds: brand_id ? [brand_id] : [],
        workflowSlug: res.locals.workflowSlug as string | undefined,
      };
      const results = await checkEmailStatuses(
        itemsWithEmail,
        { brandId: brand_id, campaignId: campaign_id },
        ctx
      );
      for (const result of results) {
        emailStatusMap.set(result.email, result);
      }
    } catch (err) {
      console.warn("[journalists-service] email-gateway enrichment failed for campaign-outlet-journalists (continuing without):", err);
    }
  }

  const enrichedRows = rows.map((row) => {
    const rowEmail = row.apolloEmail ?? row.email;
    const egResult = rowEmail ? (emailStatusMap.get(rowEmail) ?? null) : null;
    const scope = egResult?.broadcast.campaign ?? egResult?.broadcast.brand ?? null;
    const status = buildStatusBooleans(row.status, scope);
    return {
      id: row.id,
      journalistId: row.journalistId,
      campaignId: row.campaignId,
      outletId: row.outletId,
      orgId: row.orgId,
      brandIds: row.brandIds,
      featureSlug: row.featureSlug,
      relevanceScore: row.relevanceScore,
      whyRelevant: row.whyRelevant,
      whyNotRelevant: row.whyNotRelevant,
      articleUrls: row.articleUrls,
      status,
      runId: row.runId,
      createdAt: row.createdAt,
      journalistName: row.journalistName,
      firstName: row.firstName,
      lastName: row.lastName,
      entityType: row.entityType,
    };
  });

  res.json({ campaignJournalists: enrichedRows });
});

export default router;
