import { Router } from "express";
import { inArray, eq, and, arrayOverlaps } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { journalists, campaignJournalists } from "../db/schema.js";

const router = Router();

// GET /internal/outlets/contacted
const outletContactedQuerySchema = z.object({
  org_id: z.string().uuid(),
  brand_ids: z.string().transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  outlet_id: z.string().uuid(),
});

router.get("/internal/outlets/contacted", async (req, res) => {
  const parsed = outletContactedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { org_id, brand_ids, outlet_id } = parsed.data;

  if (brand_ids.length === 0) {
    res.status(400).json({ error: "brand_ids must contain at least one UUID" });
    return;
  }

  const rows = await db
    .select({ id: campaignJournalists.id })
    .from(campaignJournalists)
    .where(
      and(
        eq(campaignJournalists.orgId, org_id),
        eq(campaignJournalists.outletId, outlet_id),
        eq(campaignJournalists.status, "contacted"),
        arrayOverlaps(campaignJournalists.brandIds, brand_ids)
      )
    )
    .limit(1);

  res.json({ contacted: rows.length > 0 });
});

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

export default router;
