import { Router } from "express";
import { inArray, and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignJournalists, journalists } from "../db/schema.js";
import { checkEmailStatuses, deriveOutreachStatusFromScope, type EmailGatewayStatusResult, type OutreachStatusValue } from "../lib/email-gateway-client.js";
import { type OrgContext } from "../lib/service-context.js";
import { OutletStatusRequestSchema } from "../schemas.js";

const router = Router();

// POST /orgs/outlets/status — batch enriched outreach status from email-gateway
// Scoping is determined by scopeFilters in the body, not headers.

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

const CLASSIFICATION_RANK: Record<string, number> = { neutral: 0, negative: 1, positive: 2 };

function bestClassification(
  current: "positive" | "negative" | "neutral" | null,
  candidate: "positive" | "negative" | "neutral" | null,
): "positive" | "negative" | "neutral" | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return CLASSIFICATION_RANK[candidate] > CLASSIFICATION_RANK[current] ? candidate : current;
}

router.post("/orgs/outlets/status", async (req, res) => {
  const parsed = OutletStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const { outletIds, scopeFilters } = parsed.data;

  if (!scopeFilters.brandId && !scopeFilters.campaignId) {
    res.status(400).json({ error: "scopeFilters.brandId or scopeFilters.campaignId is required" });
    return;
  }

  const orgId = res.locals.orgId as string;
  const brandId = scopeFilters.brandId;
  const campaignId = scopeFilters.campaignId;

  try {
    // 1. Get all campaign_journalists for these outlets, scoped by org + scopeFilters
    const conditions = [
      inArray(campaignJournalists.outletId, outletIds),
      eq(campaignJournalists.orgId, orgId),
    ];
    if (campaignId) {
      conditions.push(eq(campaignJournalists.campaignId, campaignId));
    }
    if (brandId) {
      const pgArray = `{${brandId}}`;
      conditions.push(sql`${campaignJournalists.brandIds} && ${pgArray}::uuid[]`);
    }

    const rows = await db
      .select({
        cjId: campaignJournalists.id,
        outletId: campaignJournalists.outletId,
        journalistId: campaignJournalists.journalistId,
        campaignId: campaignJournalists.campaignId,
        status: campaignJournalists.status,
        email: campaignJournalists.email,
        apolloEmail: journalists.apolloEmail,
      })
      .from(campaignJournalists)
      .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
      .where(and(...conditions));

    // Group by outlet
    const byOutlet = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byOutlet.get(row.outletId) ?? [];
      list.push(row);
      byOutlet.set(row.outletId, list);
    }

    // 2. Collect all journalists with emails for email-gateway batch call
    const resolvedEmails = new Map<string, string>(); // cjId → email
    const emailItems: Array<{ email: string; outletId: string; cjId: string }> = [];
    for (const row of rows) {
      const email = row.apolloEmail ?? row.email;
      if (email) {
        resolvedEmails.set(row.cjId, email);
        emailItems.push({ email, outletId: row.outletId, cjId: row.cjId });
      }
    }

    // 3. Call email-gateway for real-time statuses
    const emailStatusMap = new Map<string, EmailGatewayStatusResult>();
    if (emailItems.length > 0) {
      const ctx: OrgContext = {
        orgId,
        userId: res.locals.userId as string | undefined,
        runId: res.locals.runId as string | undefined,
        campaignId: res.locals.campaignId as string | undefined,
        brandIds: (res.locals.brandIds as string[]) || [],
        featureSlug: res.locals.featureSlug as string | undefined,
        workflowSlug: res.locals.workflowSlug as string | undefined,
      };

      const gatewayResults = await checkEmailStatuses(
        emailItems.map(({ email }) => ({ email })),
        { brandId, campaignId },
        ctx
      );

      for (const result of gatewayResults) {
        emailStatusMap.set(result.email, result);
      }
    }

    // 4. Build results per outlet
    // Mode: campaign (campaignId present) → flat outreachStatus, no byCampaign
    // Mode: brand (brandId, no campaignId) → outreachStatus high watermark + byCampaign breakdown
    const isBrandMode = !!brandId && !campaignId;

    type OutletResult = {
      outreachStatus: OutreachStatusValue;
      replyClassification: "positive" | "negative" | "neutral" | null;
      byCampaign?: Record<string, {
        outreachStatus: OutreachStatusValue;
        replyClassification: "positive" | "negative" | "neutral" | null;
      }>;
    };

    const results: Record<string, OutletResult> = {};

    for (const outletId of outletIds) {
      const outletRows = byOutlet.get(outletId) ?? [];
      let highWatermark: OutreachStatusValue = "served";
      let topClassification: "positive" | "negative" | "neutral" | null = null;

      // For brand mode: build per-campaign breakdown
      const campaignBreakdown = new Map<string, {
        highWatermark: OutreachStatusValue;
        classification: "positive" | "negative" | "neutral" | null;
      }>();

      for (const row of outletRows) {
        const resolvedEmail = resolvedEmails.get(row.cjId);
        const egResult = resolvedEmail ? (emailStatusMap.get(resolvedEmail) ?? null) : null;

        if (isBrandMode) {
          // Top-level high watermark: use brand scope (aggregate across all campaigns)
          const brandScope = egResult?.broadcast.brand ?? null;
          const brandOutreach = deriveOutreachStatusFromScope(row.status, brandScope);
          highWatermark = higherStatus(highWatermark, brandOutreach) as OutreachStatusValue;
          if (brandOutreach === "replied") {
            topClassification = bestClassification(topClassification, brandScope?.replyClassification ?? null);
          }

          // Per-campaign breakdown: use byCampaign entry for this specific campaign
          const campaignScope = egResult?.broadcast.byCampaign?.[row.campaignId] ?? null;
          const campaignOutreach = deriveOutreachStatusFromScope(row.status, campaignScope);
          const existing = campaignBreakdown.get(row.campaignId);
          if (!existing) {
            campaignBreakdown.set(row.campaignId, {
              highWatermark: campaignOutreach,
              classification: campaignScope?.replyClassification ?? null,
            });
          } else {
            existing.highWatermark = higherStatus(existing.highWatermark, campaignOutreach) as OutreachStatusValue;
            existing.classification = bestClassification(existing.classification, campaignScope?.replyClassification ?? null);
          }
        } else {
          // Campaign mode: use campaign scope directly
          const scope = egResult?.broadcast.campaign ?? null;
          const rowOutreach = deriveOutreachStatusFromScope(row.status, scope);
          highWatermark = higherStatus(highWatermark, rowOutreach) as OutreachStatusValue;
          if (rowOutreach === "replied" && scope) {
            topClassification = bestClassification(topClassification, scope.replyClassification);
          }
        }
      }

      const entry: OutletResult = {
        outreachStatus: highWatermark,
        replyClassification: highWatermark === "replied" ? topClassification : null,
      };

      if (isBrandMode) {
        const byCampaign: Record<string, { outreachStatus: OutreachStatusValue; replyClassification: "positive" | "negative" | "neutral" | null }> = {};
        for (const [campId, data] of campaignBreakdown) {
          byCampaign[campId] = {
            outreachStatus: data.highWatermark,
            replyClassification: data.highWatermark === "replied" ? data.classification : null,
          };
        }
        entry.byCampaign = byCampaign;
      }

      results[outletId] = entry;
    }

    res.json({ results });
  } catch (err) {
    console.error("[journalists-service] /orgs/outlets/status error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
