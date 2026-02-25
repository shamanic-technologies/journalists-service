import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignOutletJournalists } from "../db/schema.js";
import {
  CreateCampaignOutletJournalistSchema,
  UpdateCampaignOutletJournalistSchema,
} from "../schemas.js";

const router = Router();

// POST /campaign-outlet-journalists
router.post("/campaign-outlet-journalists", async (req, res) => {
  const parsed = CreateCampaignOutletJournalistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { relevanceScore, ...rest } = parsed.data;

  try {
    const [result] = await db
      .insert(campaignOutletJournalists)
      .values({
        ...rest,
        relevanceScore: String(relevanceScore),
      })
      .returning();

    res.status(201).json({ campaignOutletJournalist: result });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      res
        .status(409)
        .json({ error: "Campaign-outlet-journalist link already exists" });
      return;
    }
    throw err;
  }
});

// GET /campaign-outlet-journalists
router.get("/campaign-outlet-journalists", async (req, res) => {
  const { campaign_id, outlet_id } = req.query as {
    campaign_id?: string;
    outlet_id?: string;
  };

  if (!campaign_id) {
    res.status(400).json({ error: "campaign_id is required" });
    return;
  }

  const conditions = [
    eq(campaignOutletJournalists.campaignId, campaign_id),
  ];
  if (outlet_id) {
    conditions.push(eq(campaignOutletJournalists.outletId, outlet_id));
  }

  const rows = await db
    .select()
    .from(campaignOutletJournalists)
    .where(and(...conditions));

  res.json({ campaignOutletJournalists: rows });
});

// PATCH /campaign-outlet-journalists/:campaignId/:outletId/:journalistId
router.patch(
  "/campaign-outlet-journalists/:campaignId/:outletId/:journalistId",
  async (req, res) => {
    const { campaignId, outletId, journalistId } = req.params;
    const parsed = UpdateCampaignOutletJournalistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { relevanceScore, ...rest } = parsed.data;
    const updateData: Record<string, unknown> = {
      ...rest,
      updatedAt: new Date(),
    };
    if (relevanceScore !== undefined) {
      updateData.relevanceScore = String(relevanceScore);
    }

    const [result] = await db
      .update(campaignOutletJournalists)
      .set(updateData)
      .where(
        and(
          eq(campaignOutletJournalists.campaignId, campaignId),
          eq(campaignOutletJournalists.outletId, outletId),
          eq(campaignOutletJournalists.journalistId, journalistId)
        )
      )
      .returning();

    if (!result) {
      res
        .status(404)
        .json({ error: "Campaign-outlet-journalist link not found" });
      return;
    }

    res.json({ campaignOutletJournalist: result });
  }
);

export default router;
