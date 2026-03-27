import { Router } from "express";
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
import { DiscoverJournalistsSchema } from "../schemas.js";
import type { ServiceContext } from "../lib/service-context.js";

const router = Router();

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

router.post("/journalists/discover", async (req, res) => {
  const parsed = DiscoverJournalistsSchema.safeParse(req.body);
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
    const childRun = await createChildRun(
      {
        parentRunId: ctx.runId,
        serviceName: "journalists-service",
        taskName: "discover-journalists",
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

    const stored = await discoverAndScoreJournalists({
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

    res.json({
      journalists: stored,
      totalJournalistsStored: stored.length,
    });
  } catch (err) {
    console.error("Discover journalists error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
