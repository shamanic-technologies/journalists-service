import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { journalists, campaignJournalists } from "../db/schema.js";

const router = Router();

// GET /internal/journalists/by-ids
router.get("/internal/journalists/by-ids", async (req, res) => {
  const idsParam = req.query.ids as string;
  if (!idsParam) {
    res.status(400).json({ error: "ids query parameter is required" });
    return;
  }

  const ids = idsParam.split(",").map((id) => id.trim());
  if (ids.length === 0) {
    res.json({ journalists: [] });
    return;
  }

  const rows = await db
    .select()
    .from(journalists)
    .where(inArray(journalists.id, ids));

  res.json({ journalists: rows });
});

// PATCH /internal/campaign-journalists/:id/contacted
// Transitions a campaign journalist from "served" to "contacted"
// Called by email-gateway when an email is successfully sent to the journalist
router.patch("/internal/campaign-journalists/:id/contacted", async (req, res) => {
  const { id } = req.params;

  const rows = await db
    .select({ id: campaignJournalists.id, status: campaignJournalists.status })
    .from(campaignJournalists)
    .where(eq(campaignJournalists.id, id));

  if (rows.length === 0) {
    res.status(404).json({ error: "Campaign journalist not found" });
    return;
  }

  if (rows[0].status !== "served") {
    res.status(409).json({
      error: `Cannot transition to contacted: current status is "${rows[0].status}", expected "served"`,
    });
    return;
  }

  await db
    .update(campaignJournalists)
    .set({ status: "contacted" })
    .where(eq(campaignJournalists.id, id));

  console.log(`[journalists-service] Campaign journalist ${id} marked as contacted`);
  res.json({ success: true });
});

export default router;
