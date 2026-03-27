import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";

const router = Router();

const querySchema = z.object({
  campaign_id: z.string().uuid(),
  outlet_id: z.string().uuid().optional(),
});

// GET /campaign-outlet-journalists?campaign_id=...&outlet_id=...
router.get("/campaign-outlet-journalists", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "campaign_id (uuid) is required" });
    return;
  }

  const { campaign_id, outlet_id } = parsed.data;

  const conditions = [eq(campaignJournalists.campaignId, campaign_id)];
  if (outlet_id) {
    conditions.push(eq(campaignJournalists.outletId, outlet_id));
  }

  const rows = await db
    .select({
      id: campaignJournalists.id,
      journalistId: campaignJournalists.journalistId,
      campaignId: campaignJournalists.campaignId,
      outletId: campaignJournalists.outletId,
      orgId: campaignJournalists.orgId,
      brandId: campaignJournalists.brandId,
      featureSlug: campaignJournalists.featureSlug,
      relevanceScore: campaignJournalists.relevanceScore,
      whyRelevant: campaignJournalists.whyRelevant,
      whyNotRelevant: campaignJournalists.whyNotRelevant,
      articleUrls: campaignJournalists.articleUrls,
      status: campaignJournalists.status,
      createdAt: campaignJournalists.createdAt,
      journalistName: journalists.journalistName,
      firstName: journalists.firstName,
      lastName: journalists.lastName,
      entityType: journalists.entityType,
    })
    .from(campaignJournalists)
    .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
    .where(and(...conditions));

  res.json({ campaignJournalists: rows });
});

export default router;
