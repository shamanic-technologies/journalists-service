import { Router } from "express";
import { inArray, and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists } from "../db/schema.js";
import { checkEmailStatuses } from "../lib/email-gateway-client.js";
import { type ServiceContext } from "../lib/service-context.js";
import { OutletStatusRequestSchema } from "../schemas.js";

const router = Router();

// POST /internal/outlets/status — batch enriched status from email-gateway
// Only requires base headers (x-org-id, x-user-id, x-run-id).
// x-campaign-id is optional: when present, scopes to that campaign; when absent, aggregates across all campaigns for the org.
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
  const campaignId = res.locals.campaignId as string; // empty string when not provided
  const brandIds = (res.locals.brandIds as string[]) ?? [];

  try {
    // 1. Get all campaign_journalists for these outlets, scoped by org (+ campaign when provided)
    const conditions = [
      inArray(campaignJournalists.outletId, outletIds),
      eq(campaignJournalists.orgId, orgId),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }

    const rows = await db
      .select({
        cjId: campaignJournalists.id,
        outletId: campaignJournalists.outletId,
        journalistId: campaignJournalists.journalistId,
        status: campaignJournalists.status,
        email: campaignJournalists.email,
      })
      .from(campaignJournalists)
      .where(and(...conditions));

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
        featureSlug: (res.locals.featureSlug as string) ?? "",
        workflowSlug: (res.locals.workflowSlug as string) ?? "",
      };

      const gatewayResults = await checkEmailStatuses(
        emailItems.map(({ leadId, email }) => ({ leadId, email })),
        campaignId || undefined,
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
    }> = {};

    for (const outletId of outletIds) {
      const outletRows = byOutlet.get(outletId) ?? [];
      let highWatermark = "served";
      let bestClassification: "positive" | "negative" | "neutral" | null = null;

      for (const row of outletRows) {
        // Start with DB status — widen type since email-gateway can produce "delivered"/"replied"
        let enrichedStatus: string = row.status;

        // Enrich with email-gateway if available
        if (row.email) {
          const egStatus = emailStatusMap.get(`${row.journalistId}:${row.email}`);
          if (egStatus) {
            if (egStatus.replied) {
              enrichedStatus = higherStatus(enrichedStatus, "replied");
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
          }
        }

        highWatermark = higherStatus(highWatermark, enrichedStatus);
      }

      results[outletId] = {
        status: highWatermark,
        replyClassification: highWatermark === "replied" ? bestClassification : null,
      };
    }

    console.log(
      `[journalists-service] POST /internal/outlets/status: ${outletIds.length} outlets, ${rows.length} journalists (orgId=${orgId}${campaignId ? ` campaignId=${campaignId}` : ""})`
    );

    res.json({ results });
  } catch (err) {
    console.error("[journalists-service] /internal/outlets/status error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
