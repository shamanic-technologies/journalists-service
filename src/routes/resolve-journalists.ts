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

const router = Router();

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

router.post("/journalists/resolve", async (req, res) => {
  const parsed = ResolveJournalistsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, maxArticles } = parsed.data;

  const orgId = res.locals.orgId as string;
  const userId = res.locals.userId as string;
  const runId = res.locals.runId as string;
  const featureSlug = res.locals.featureSlug as string | null;
  const campaignId = res.locals.campaignId as string | null;
  const brandId = res.locals.brandId as string | null;

  if (!campaignId) {
    res.status(400).json({ error: "x-campaign-id header is required" });
    return;
  }
  if (!brandId) {
    res.status(400).json({ error: "x-brand-id header is required" });
    return;
  }

  try {
    // Check discovery cache
    const cached = await db
      .select()
      .from(discoveryCache)
      .where(
        and(
          eq(discoveryCache.orgId, orgId),
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
    const { run: childRun } = await createChildRun(
      {
        parentRunId: runId,
        service: "journalists-service",
        operation: "resolve-journalists",
      },
      orgId,
      userId,
      featureSlug
    );
    const childRunId = childRun.id;

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
        orgId,
        userId,
        childRunId,
        campaignId,
        featureSlug
      ),
      fetchCampaign(campaignId, orgId, userId, childRunId, featureSlug),
      fetchOutlet(outletId, orgId, userId, childRunId, featureSlug),
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
      orgId,
      brandId,
      userId,
      runId: childRunId,
      featureSlug,
    });

    // Upsert discovery cache
    await db
      .insert(discoveryCache)
      .values({
        orgId,
        brandId,
        campaignId,
        outletId,
        discoveredAt: new Date(),
        runId: childRunId,
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
          runId: childRunId,
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
