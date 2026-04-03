/** All propagated headers for downstream service calls */
export interface ServiceContext {
  orgId: string;
  userId: string;
  runId: string;
  featureSlug: string;
  campaignId: string;
  brandIds: string[];
  workflowSlug: string;
}

/** Build standard headers from a ServiceContext — always forwards all 7 identity headers */
export function buildServiceHeaders(
  ctx: ServiceContext,
  apiKey: string
): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "x-org-id": ctx.orgId,
    "x-user-id": ctx.userId,
    "x-run-id": ctx.runId,
    "x-campaign-id": ctx.campaignId,
    "x-brand-id": ctx.brandIds.join(","),
    "x-feature-slug": ctx.featureSlug,
    "x-workflow-slug": ctx.workflowSlug,
  };
}
