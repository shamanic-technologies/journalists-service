import { Router } from "express";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { journalists } from "../db/schema.js";
import { checkOutletBlocked } from "../lib/outlet-blocked.js";
import type { ServiceContext } from "../lib/service-context.js";

const router = Router();

// GET /internal/outlets/blocked — full dedup + local + relevance check
const outletBlockedQuerySchema = z.object({
  org_id: z.string().uuid(),
  brand_ids: z.string().transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  outlet_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
});

router.get("/internal/outlets/blocked", async (req, res) => {
  const parsed = outletBlockedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { org_id, brand_ids, outlet_id, campaign_id } = parsed.data;

  if (brand_ids.length === 0) {
    res.status(400).json({ error: "brand_ids must contain at least one UUID" });
    return;
  }

  // Build a minimal ServiceContext from identity headers
  const ctx: ServiceContext = {
    orgId: org_id,
    userId: res.locals.userId as string,
    runId: res.locals.runId as string,
    featureSlug: null,
    campaignId: campaign_id,
    brandIds: brand_ids,
    workflowSlug: null,
  };

  try {
    const result = await checkOutletBlocked(outlet_id, campaign_id, brand_ids, ctx);
    if (result.blocked) {
      console.log(
        `[journalists-service] GET /internal/outlets/blocked: ${result.reason} (outletId=${outlet_id} campaignId=${campaign_id} orgId=${org_id})`
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
