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

const router = Router();

router.post("/journalists/discover", async (req, res) => {
  const parsed = DiscoverJournalistsSchema.safeParse(req.body);
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
    const childRun = await createChildRun(
      {
        parentRunId: runId,
        serviceName: "journalists-service",
        taskName: "discover-journalists",
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

    const stored = await discoverAndScoreJournalists({
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
