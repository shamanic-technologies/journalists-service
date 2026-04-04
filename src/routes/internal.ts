import { Router } from "express";
import { inArray, and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { journalists, campaignJournalists } from "../db/schema.js";
import { checkOutletBlocked } from "../lib/outlet-blocked.js";
import { checkEmailStatuses } from "../lib/email-gateway-client.js";
import { type ServiceContext } from "../lib/service-context.js";
import { OutletStatusRequestSchema } from "../schemas.js";

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

// POST /internal/outlets/status — batch enriched status from email-gateway
const STATUS_RANK: Record<string, number> = {
  buffered: 0,
  claimed: 1,
  skipped: 2,
  served: 3,
  contacted: 4,
  delivered: 5,
  replied: 6,
};

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 0;
}

function higherStatus(a: string, b: string): string {
  return statusRank(a) >= statusRank(b) ? a : b;
}

router.post("/internal/outlets/status", async (req, res) => {
  const parsed = OutletStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { outletIds } = parsed.data;
  const orgId = res.locals.orgId as string;
  const campaignId = res.locals.campaignId as string;
  const brandIds = res.locals.brandIds as string[];

  try {
    // 1. Get all campaign_journalists for these outlets, scoped by org + campaign
    const rows = await db
      .select({
        cjId: campaignJournalists.id,
        outletId: campaignJournalists.outletId,
        journalistId: campaignJournalists.journalistId,
        status: campaignJournalists.status,
        email: campaignJournalists.email,
      })
      .from(campaignJournalists)
      .where(
        and(
          inArray(campaignJournalists.outletId, outletIds),
          eq(campaignJournalists.orgId, orgId),
          eq(campaignJournalists.campaignId, campaignId)
        )
      );

    // Group by outlet
    const byOutlet = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byOutlet.get(row.outletId) ?? [];
      list.push(row);
      byOutlet.set(row.outletId, list);
    }

    // 2. Collect all journalists with emails for email-gateway batch call
    const emailItems: Array<{ leadId: string; email: string; outletId: string; cjId: string }> = [];
    for (const row of rows) {
      if (row.email) {
        emailItems.push({
          leadId: row.journalistId,
          email: row.email,
          outletId: row.outletId,
          cjId: row.cjId,
        });
      }
    }

    // 3. Call email-gateway for real-time statuses
    const emailStatusMap = new Map<string, {
      contacted: boolean;
      delivered: boolean;
      replied: boolean;
      replyClassification: "positive" | "negative" | "neutral" | null;
    }>();
    if (emailItems.length > 0) {
      const ctx: ServiceContext = {
        orgId,
        userId: res.locals.userId as string,
        runId: res.locals.runId as string,
        campaignId,
        brandIds,
        featureSlug: res.locals.featureSlug as string,
        workflowSlug: res.locals.workflowSlug as string,
      };

      const gatewayResults = await checkEmailStatuses(
        emailItems.map(({ leadId, email }) => ({ leadId, email })),
        campaignId,
        ctx
      );

      for (const result of gatewayResults) {
        const scope = result.broadcast?.campaign?.lead ?? result.broadcast?.brand?.lead;
        if (scope) {
          emailStatusMap.set(`${result.leadId}:${result.email}`, {
            contacted: scope.contacted,
            delivered: scope.delivered,
            replied: scope.replied,
            replyClassification: scope.replyClassification,
          });
        }
      }
    }

    // 4. Build results per outlet
    const CLASSIFICATION_RANK: Record<string, number> = { neutral: 0, negative: 1, positive: 2 };
    const results: Record<string, {
      status: string;
      replyClassification: "positive" | "negative" | "neutral" | null;
      journalistCount: number;
      contactedCount: number;
    }> = {};

    for (const outletId of outletIds) {
      const outletRows = byOutlet.get(outletId) ?? [];
      let highWatermark = "served";
      let bestClassification: "positive" | "negative" | "neutral" | null = null;
      let contactedCount = 0;

      for (const row of outletRows) {
        // Start with DB status
        let enrichedStatus = row.status;

        // Enrich with email-gateway if available
        if (row.email) {
          const egStatus = emailStatusMap.get(`${row.journalistId}:${row.email}`);
          if (egStatus) {
            if (egStatus.replied) {
              enrichedStatus = higherStatus(enrichedStatus, "replied");
              // Track best reply classification: positive > negative > neutral
              if (egStatus.replyClassification) {
                if (!bestClassification || CLASSIFICATION_RANK[egStatus.replyClassification] > CLASSIFICATION_RANK[bestClassification]) {
                  bestClassification = egStatus.replyClassification;
                }
              }
            } else if (egStatus.delivered) {
              enrichedStatus = higherStatus(enrichedStatus, "delivered");
            } else if (egStatus.contacted) {
              enrichedStatus = higherStatus(enrichedStatus, "contacted");
            }

            if (egStatus.contacted) {
              contactedCount++;
            }
          }
        }

        highWatermark = higherStatus(highWatermark, enrichedStatus);
      }

      results[outletId] = {
        status: highWatermark,
        replyClassification: highWatermark === "replied" ? bestClassification : null,
        journalistCount: outletRows.length,
        contactedCount,
      };
    }

    console.log(
      `[journalists-service] POST /internal/outlets/status: ${outletIds.length} outlets, ${rows.length} journalists (orgId=${orgId} campaignId=${campaignId})`
    );

    res.json({ results });
  } catch (err) {
    console.error("[journalists-service] /internal/outlets/status error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
