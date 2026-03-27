/** All propagated headers for downstream service calls */
export interface ServiceContext {
  orgId: string;
  userId: string;
  runId: string;
  featureSlug: string | null;
  campaignId: string | null;
  brandId: string | null;
  workflowName: string | null;
}

/** Build standard headers from a ServiceContext */
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
  if (ctx.featureSlug) headers["x-feature-slug"] = ctx.featureSlug;
  if (ctx.campaignId) headers["x-campaign-id"] = ctx.campaignId;
  if (ctx.brandId) headers["x-brand-id"] = ctx.brandId;
  if (ctx.workflowName) headers["x-workflow-name"] = ctx.workflowName;
  return headers;
}
