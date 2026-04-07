import { Router } from "express";
import { z } from "zod";
import { checkOutletBlocked } from "../lib/outlet-blocked.js";
import type { OrgContext } from "../lib/service-context.js";

const router = Router();

// GET /orgs/outlets/blocked — relevance threshold check
// All identity/context comes from headers (enforced by requireOrgId middleware).
// Only outlet_id is a query param (it's the resource being queried).
const outletBlockedQuerySchema = z.object({
  outlet_id: z.string().uuid(),
});

router.get("/orgs/outlets/blocked", async (req, res) => {
  const parsed = outletBlockedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { outlet_id } = parsed.data;
  const campaignId = (res.locals.campaignId as string) || "";
  const orgId = res.locals.orgId as string;
  const brandIds = res.locals.brandIds as string[];

  const ctx: OrgContext = {
    orgId,
    userId: res.locals.userId as string | undefined,
    runId: res.locals.runId as string | undefined,
    campaignId: campaignId || undefined,
    brandIds,
    featureSlug: res.locals.featureSlug as string | undefined,
    workflowSlug: res.locals.workflowSlug as string | undefined,
  };

  try {
    const result = await checkOutletBlocked(outlet_id, campaignId, orgId, brandIds, ctx);
    if (result.blocked) {
      console.log(
        `[journalists-service] GET /orgs/outlets/blocked: ${result.reason} (outletId=${outlet_id} campaignId=${campaignId} orgId=${orgId})`
      );
      res.json({ blocked: true, reason: result.reason });
      return;
    }

    res.json({ blocked: false });
  } catch (err) {
    console.error("[journalists-service] /orgs/outlets/blocked error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
