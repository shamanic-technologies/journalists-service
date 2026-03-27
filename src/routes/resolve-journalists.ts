import { Router } from "express";
import { db } from "../db/index.js";
import { journalists, campaignJournalists, discoveryCache } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { createChildRun } from "../lib/runs-client.js";
import {
  extractBrandFields,
  getFieldValue,
} from "../lib/brand-client.js";
import { fetchCampaign } from "../lib/campaign-client.js";
import { fetchOutlet } from "../lib/outlets-client.js";
import {
  extractDomain,
  discoverAndScoreJournalists,
} from "../lib/journalist-discovery.js";
import { ResolveJournalistsSchema } from "../schemas.js";
import type { ServiceContext } from "../lib/service-context.js";

const router = Router();

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCtx(locals: Record<string, unknown>): ServiceContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string,
    runId: locals.runId as string,
    featureSlug: locals.featureSlug as string | null,
    campaignId: locals.campaignId as string | null,
    brandId: locals.brandId as string | null,
    workflowName: locals.workflowName as string | null,
  };
}

router.post("/journalists/resolve", async (req, res) => {
  const parsed = ResolveJournalistsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, maxArticles, count, acceptanceThreshold } = parsed.data;
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
    // Check discovery cache
    const cached = await db
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
      cached.length > 0 &&
      Date.now() - new Date(cached[0].discoveredAt).getTime() < CACHE_MAX_AGE_MS;

    if (isFresh) {
      const result = await fetchResolvedJournalists(campaignId, outletId);
      res.json({ journalists: result, cached: true });
      return;
    }

    // Slow path: discover + score
    const childRun = await createChildRun(
      {
        parentRunId: ctx.runId,
        serviceName: "journalists-service",
        taskName: "resolve-journalists",
      },
      ctx
    );
    const childCtx: ServiceContext = { ...ctx, runId: childRun.id };

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

    const brandName = getFieldValue(brandFields.results, "brand_name") || "Unknown Brand";
    const brandDescription = getFieldValue(brandFields.results, "brand_description");
    const featureInputs = campaign.featureInputs ?? {};
    const outletDomain = extractDomain(outlet.outletUrl);

    await discoverAndScoreJournalists({
      outletDomain,
      outletId,
      campaignId,
      brandName,
      brandDescription,
      featureInputs,
      maxArticles,
      count,
      acceptanceThreshold,
      orgId: ctx.orgId,
      brandId,
      ctx: childCtx,
    });

    // Upsert discovery cache
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

    const result = await fetchResolvedJournalists(campaignId, outletId);
    res.json({ journalists: result, cached: false });
  } catch (err) {
    console.error("Resolve journalists error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

// ── Fetch resolved journalists ───────────────────────────────────────

interface ResolvedJournalist {
  id: string;
  journalistName: string;
  firstName: string;
  lastName: string;
  entityType: string;
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: string[];
}

async function fetchResolvedJournalists(
  campaignId: string,
  outletId: string
): Promise<ResolvedJournalist[]> {
  const rows = await db
    .select({
      id: journalists.id,
      journalistName: journalists.journalistName,
      firstName: journalists.firstName,
      lastName: journalists.lastName,
      entityType: journalists.entityType,
      relevanceScore: campaignJournalists.relevanceScore,
      whyRelevant: campaignJournalists.whyRelevant,
      whyNotRelevant: campaignJournalists.whyNotRelevant,
      articleUrls: campaignJournalists.articleUrls,
    })
    .from(campaignJournalists)
    .innerJoin(journalists, eq(campaignJournalists.journalistId, journalists.id))
    .where(
      and(
        eq(campaignJournalists.campaignId, campaignId),
        eq(campaignJournalists.outletId, outletId)
      )
    );

  return rows
    .map((r) => ({
      id: r.id,
      journalistName: r.journalistName,
      firstName: r.firstName || "",
      lastName: r.lastName || "",
      entityType: r.entityType,
      relevanceScore: Number(r.relevanceScore),
      whyRelevant: r.whyRelevant,
      whyNotRelevant: r.whyNotRelevant,
      articleUrls: (r.articleUrls as string[]) || [],
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export default router;
