import { Router } from "express";
import { db, sql as pgClient } from "../db/index.js";
import {
  campaignJournalists,
  journalists,
  discoveryCache,
  idempotencyCache,
} from "../db/schema.js";
import { eq, and, lt } from "drizzle-orm";
import { createChildRun } from "../lib/runs-client.js";
import {
  extractBrandFields,
  getFieldValue,
} from "../lib/brand-client.js";
import { fetchCampaign } from "../lib/campaign-client.js";
import { fetchOutlet } from "../lib/outlets-client.js";
import { extractDomain, refillBuffer } from "../lib/journalist-discovery.js";
import { BufferNextSchema } from "../schemas.js";
import type { ServiceContext } from "../lib/service-context.js";

const router = Router();

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IDEMPOTENCY_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const MAX_PULL_ITERATIONS = 100;
const CLEANUP_PROBABILITY = 0.01;

function getCtx(locals: Record<string, unknown>): ServiceContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string,
    runId: locals.runId as string,
    featureSlug: locals.featureSlug as string | null,
    campaignId: locals.campaignId as string | null,
    brandId: locals.brandId as string | null,
    workflowSlug: locals.workflowSlug as string | null,
  };
}

interface BufferNextResponse {
  found: boolean;
  journalist?: {
    id: string;
    journalistName: string;
    firstName: string;
    lastName: string;
    entityType: string;
    relevanceScore: number;
    whyRelevant: string;
    whyNotRelevant: string;
    articleUrls: string[];
  };
}

/** Probabilistic cleanup of expired idempotency keys */
async function maybeCleanupIdempotencyCache(): Promise<void> {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  try {
    await db
      .delete(idempotencyCache)
      .where(lt(idempotencyCache.expiresAt, new Date()));
    console.log("[journalists-service] Idempotency cache cleanup ran");
  } catch {
    // Non-critical — ignore errors
  }
}

router.post("/buffer/next", async (req, res) => {
  const parsed = BufferNextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, maxArticles, idempotencyKey } = parsed.data;
  const ctx = getCtx(res.locals);

  if (!ctx.campaignId) {
    res.status(400).json({ error: "x-campaign-id header is required" });
    return;
  }
  if (!ctx.brandId) {
    res.status(400).json({ error: "x-brand-id header is required" });
    return;
  }

  const campaignId = ctx.campaignId;
  const brandId = ctx.brandId;

  try {
    // Probabilistic cleanup
    maybeCleanupIdempotencyCache();

    // Check idempotency cache
    if (idempotencyKey) {
      const cached = await db
        .select()
        .from(idempotencyCache)
        .where(eq(idempotencyCache.idempotencyKey, idempotencyKey));

      if (cached.length > 0 && new Date(cached[0].expiresAt) > new Date()) {
        res.json(cached[0].responseBody);
        return;
      }
    }

    const childRun = await createChildRun(
      {
        parentRunId: ctx.runId,
        serviceName: "journalists-service",
        taskName: "buffer-next",
      },
      ctx
    );
    const childCtx: ServiceContext = { ...ctx, runId: childRun.id };

    let response: BufferNextResponse = { found: false };
    let hasAttemptedRefill = false;

    for (let i = 0; i < MAX_PULL_ITERATIONS; i++) {
      // Atomic claim: SELECT ... FOR UPDATE SKIP LOCKED
      const claimed = await claimNextBuffered(campaignId, outletId);

      if (claimed) {
        // Mark as served
        await db
          .update(campaignJournalists)
          .set({ status: "served" })
          .where(eq(campaignJournalists.id, claimed.campaignJournalistId));

        response = {
          found: true,
          journalist: {
            id: claimed.journalistId,
            journalistName: claimed.journalistName,
            firstName: claimed.firstName || "",
            lastName: claimed.lastName || "",
            entityType: claimed.entityType,
            relevanceScore: Number(claimed.relevanceScore),
            whyRelevant: claimed.whyRelevant,
            whyNotRelevant: claimed.whyNotRelevant,
            articleUrls: (claimed.articleUrls as string[]) || [],
          },
        };
        break;
      }

      // Buffer empty — try refill (only once)
      if (hasAttemptedRefill) {
        response = { found: false };
        break;
      }

      hasAttemptedRefill = true;

      // Check discovery cache — if fresh, no more journalists to find
      const discoveryCached = await db
        .select()
        .from(discoveryCache)
        .where(
          and(
            eq(discoveryCache.orgId, ctx.orgId),
            eq(discoveryCache.brandId, brandId),
            eq(discoveryCache.campaignId, campaignId),
            eq(discoveryCache.outletId, outletId)
          )
        );

      const isFresh =
        discoveryCached.length > 0 &&
        Date.now() - new Date(discoveryCached[0].discoveredAt).getTime() <
          CACHE_MAX_AGE_MS;

      if (isFresh) {
        // Discovery already ran recently — buffer is genuinely empty (all served/skipped)
        response = { found: false };
        break;
      }

      // Refill buffer
      const [brandFields, campaign, outlet] = await Promise.all([
        extractBrandFields(
          brandId,
          [
            { key: "brand_name", description: "The brand's name" },
            {
              key: "brand_description",
              description:
                "A concise description of what the brand does, its products, and market positioning",
            },
          ],
          childCtx
        ),
        fetchCampaign(campaignId, childCtx),
        fetchOutlet(outletId, childCtx),
      ]);

      const brandName =
        getFieldValue(brandFields.results, "brand_name") || "Unknown Brand";
      const brandDescription = getFieldValue(
        brandFields.results,
        "brand_description"
      );
      const featureInputs = campaign.featureInputs ?? {};
      const outletDomain = extractDomain(outlet.outletUrl);

      const filled = await refillBuffer({
        outletDomain,
        outletId,
        campaignId,
        brandName,
        brandDescription,
        featureInputs,
        maxArticles,
        orgId: ctx.orgId,
        brandId,
        ctx: childCtx,
      });

      // Update discovery cache
      await db
        .insert(discoveryCache)
        .values({
          orgId: ctx.orgId,
          brandId,
          campaignId,
          outletId,
          discoveredAt: new Date(),
          runId: childRun.id,
        })
        .onConflictDoUpdate({
          target: [
            discoveryCache.orgId,
            discoveryCache.brandId,
            discoveryCache.campaignId,
            discoveryCache.outletId,
          ],
          set: {
            discoveredAt: new Date(),
            runId: childRun.id,
          },
        });

      if (filled === 0) {
        response = { found: false };
        break;
      }

      // Loop back to claim from the freshly-filled buffer
    }

    // Save to idempotency cache
    if (idempotencyKey) {
      await db
        .insert(idempotencyCache)
        .values({
          idempotencyKey,
          responseBody: response,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        })
        .onConflictDoUpdate({
          target: idempotencyCache.idempotencyKey,
          set: {
            responseBody: response,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
    }

    res.json(response);
  } catch (err) {
    console.error("[journalists-service] Buffer/next error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

// ── Atomic claim via FOR UPDATE SKIP LOCKED ──────────────────────────

interface ClaimedRow {
  campaignJournalistId: string;
  journalistId: string;
  journalistName: string;
  firstName: string | null;
  lastName: string | null;
  entityType: string;
  relevanceScore: string;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: unknown;
}

async function claimNextBuffered(
  campaignId: string,
  outletId: string
): Promise<ClaimedRow | null> {
  const rows = await pgClient`
    UPDATE campaign_journalists
    SET status = 'claimed'
    WHERE id = (
      SELECT cj.id
      FROM campaign_journalists cj
      WHERE cj.campaign_id = ${campaignId}
        AND cj.outlet_id = ${outletId}
        AND cj.status = 'buffered'
      ORDER BY cj.relevance_score DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id AS "campaignJournalistId",
      journalist_id AS "journalistId"
  `;

  if (rows.length === 0) return null;

  const row = rows[0];

  // Fetch journalist details
  const journalistRows = await db
    .select()
    .from(journalists)
    .where(eq(journalists.id, row.journalistId as string));

  if (journalistRows.length === 0) return null;

  const j = journalistRows[0];

  // Fetch campaign_journalist details for scores
  const cjRows = await db
    .select()
    .from(campaignJournalists)
    .where(eq(campaignJournalists.id, row.campaignJournalistId as string));

  if (cjRows.length === 0) return null;

  const cj = cjRows[0];

  return {
    campaignJournalistId: cj.id,
    journalistId: j.id,
    journalistName: j.journalistName,
    firstName: j.firstName,
    lastName: j.lastName,
    entityType: j.entityType,
    relevanceScore: cj.relevanceScore,
    whyRelevant: cj.whyRelevant,
    whyNotRelevant: cj.whyNotRelevant,
    articleUrls: cj.articleUrls,
  };
}

export default router;
