/** Org-scoped context parsed from request headers by requireOrgId middleware.
 *  Only orgId is guaranteed; all other fields are optional. */
export interface OrgContext {
  orgId: string;
  userId?: string;
  runId?: string;
  campaignId?: string;
  brandIds: string[];
  featureSlug?: string;
  workflowSlug?: string;
}

/** Build standard headers from an OrgContext — always forwards x-api-key and x-org-id,
 *  other headers only when present. */
export function buildServiceHeaders(
  apiKey: string,
  ctx: OrgContext
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "x-org-id": ctx.orgId,
  };
  if (ctx.userId) headers["x-user-id"] = ctx.userId;
  if (ctx.runId) headers["x-run-id"] = ctx.runId;
  if (ctx.campaignId) headers["x-campaign-id"] = ctx.campaignId;
  const brandId = ctx.brandIds.join(",");
  if (brandId) headers["x-brand-id"] = brandId;
  if (ctx.featureSlug) headers["x-feature-slug"] = ctx.featureSlug;
  if (ctx.workflowSlug) headers["x-workflow-slug"] = ctx.workflowSlug;
  return headers;
}
