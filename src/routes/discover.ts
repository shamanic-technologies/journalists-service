import { Router } from "express";
import { db } from "../db/index.js";
import { discoveryCache } from "../db/schema.js";
import { createChildRun, closeRun } from "../lib/runs-client.js";
import {
  extractBrandFields,
  getFieldValue,
} from "../lib/brand-client.js";
import { fetchCampaign } from "../lib/campaign-client.js";
import { fetchOutlet } from "../lib/outlets-client.js";
import {
  extractDomain,
  refillBuffer,
} from "../lib/journalist-discovery.js";
import { DiscoverRequestSchema } from "../schemas.js";
import type { OrgContext } from "../lib/service-context.js";

const router = Router();

function getCtx(locals: Record<string, unknown>): OrgContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string | undefined,
    runId: locals.runId as string | undefined,
    featureSlug: locals.featureSlug as string | undefined,
    campaignId: locals.campaignId as string | undefined,
    brandIds: (locals.brandIds as string[]) || [],
    workflowSlug: locals.workflowSlug as string | undefined,
  };
}

router.post("/orgs/discover", async (req, res) => {
  const parsed = DiscoverRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, maxArticles } = parsed.data;
  const ctx = getCtx(res.locals);

  if (!ctx.campaignId) {
    res.status(400).json({ error: "x-campaign-id header is required" });
    return;
  }
  if (ctx.brandIds.length === 0) {
    res.status(400).json({ error: "x-brand-id header is required" });
    return;
  }

  const campaignId = ctx.campaignId;
  const brandIds = ctx.brandIds;

  let childRun: { id: string };
  try {
    childRun = await createChildRun(
      {
        parentRunId: ctx.runId,
        serviceName: "journalists-service",
        taskName: "discover",
      },
      ctx
    );
  } catch (err) {
    console.error("[journalists-service] Discover: failed to create run:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
    return;
  }

  const childCtx: OrgContext = { ...ctx, runId: childRun.id };

  try {
    // Fetch brand info, campaign, and outlet in parallel
    const [brandFields, campaign, outlet] = await Promise.all([
      extractBrandFields(
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
      getFieldValue(brandFields.fields, "brand_name") || "Unknown Brand";
    const brandDescription = getFieldValue(
      brandFields.fields,
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
      brandIds,
      ctx: childCtx,
      runId: childRun.id,
    });

    // Update scoring cache — keyed by (orgId, outletId)
    await db
      .insert(discoveryCache)
      .values({
        orgId: ctx.orgId,
        brandIds,
        campaignId,
        outletId,
        discoveredAt: new Date(),
        runId: childRun.id,
      })
      .onConflictDoUpdate({
        target: [
          discoveryCache.orgId,
          discoveryCache.outletId,
        ],
        set: {
          brandIds,
          campaignId,
          discoveredAt: new Date(),
          runId: childRun.id,
        },
      });

    // Close run as completed
    await closeRun(childRun.id, "completed", childCtx);

    console.log(
      `[journalists-service] POST /discover completed — outletId=${outletId} found=${filled} runId=${childRun.id}`
    );

    res.json({
      runId: childRun.id,
      discovered: filled,
    });
  } catch (err) {
    // Close run as failed
    await closeRun(childRun.id, "failed", childCtx);

    console.error("[journalists-service] Discover error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
