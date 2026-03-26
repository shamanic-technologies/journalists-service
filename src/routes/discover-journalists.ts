import { Router } from "express";
import { createChildRun } from "../lib/runs-client.js";
import { fetchBrand } from "../lib/brand-client.js";
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

  const { outletId, brandId, campaignId, featureInputs, maxArticles } =
    parsed.data;

  const orgId = res.locals.orgId as string;
  const userId = res.locals.userId as string;
  const runId = res.locals.runId as string;
  const featureSlug = res.locals.featureSlug as string | null;

  try {
    const { run: childRun } = await createChildRun(
      {
        parentRunId: runId,
        service: "journalists-service",
        operation: "discover-journalists",
      },
      orgId,
      userId,
      featureSlug
    );
    const childRunId = childRun.id;

    const [brand, outlet] = await Promise.all([
      fetchBrand(brandId, orgId, userId, childRunId, featureSlug),
      fetchOutlet(outletId, orgId, userId, childRunId, featureSlug),
    ]);

    const brandName = brand.name || "Unknown Brand";
    const brandDescription = [brand.elevatorPitch, brand.bio, brand.mission]
      .filter(Boolean)
      .join(". ");
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
