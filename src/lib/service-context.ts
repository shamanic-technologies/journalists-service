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

/** Build standard headers from a ServiceContext — always forwards all 7 identity headers.
 *  Workflow-context headers are omitted when empty (read/stats endpoints called outside workflow context). */
export function buildServiceHeaders(
  ctx: ServiceContext,
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "x-org-id": ctx.orgId,
    "x-user-id": ctx.userId,
    "x-run-id": ctx.runId,
  };
  if (ctx.campaignId) headers["x-campaign-id"] = ctx.campaignId;
  const brandId = ctx.brandIds.join(",");
  if (brandId) headers["x-brand-id"] = brandId;
  if (ctx.featureSlug) headers["x-feature-slug"] = ctx.featureSlug;
  if (ctx.workflowSlug) headers["x-workflow-slug"] = ctx.workflowSlug;
  return headers;
}
