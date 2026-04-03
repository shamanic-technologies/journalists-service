import { Router } from "express";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { journalists } from "../db/schema.js";
import { checkOutletBlocked } from "../lib/outlet-blocked.js";

const router = Router();

// GET /internal/outlets/blocked — relevance threshold check
// All identity/context comes from headers (enforced by middleware).
// Only outlet_id is a query param (it's the resource being queried).
const outletBlockedQuerySchema = z.object({
  outlet_id: z.string().uuid(),
});

router.get("/internal/outlets/blocked", async (req, res) => {
  const parsed = outletBlockedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { outlet_id } = parsed.data;
  const campaignId = res.locals.campaignId as string;
  const orgId = res.locals.orgId as string;
  const brandIds = res.locals.brandIds as string[];

  try {
    const result = await checkOutletBlocked(outlet_id, campaignId, orgId, brandIds);
    if (result.blocked) {
      console.log(
        `[journalists-service] GET /internal/outlets/blocked: ${result.reason} (outletId=${outlet_id} campaignId=${campaignId} orgId=${orgId})`
      );
      res.json({ blocked: true, reason: result.reason });
      return;
    }

    res.json({ blocked: false });
  } catch (err) {
    console.error("[journalists-service] /internal/outlets/blocked error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
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
