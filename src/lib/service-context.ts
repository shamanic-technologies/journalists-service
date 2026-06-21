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
  /** Priority audience attribution (human-service org-scoped saved filter-set, audience.id).
   *  Set by campaign-service at run start, forwarded by workflow-service via x-audience-id.
   *  Optional — absent outside the campaign flow; omit, never throw. */
  audienceId?: string;
}

/** Build an OrgContext from res.locals populated by requireOrgId middleware.
 *  Single source so adding a tracking field (e.g. audienceId) is a one-line change here,
 *  not a per-route sweep. */
export function orgContextFromLocals(
  locals: Record<string, unknown>
): OrgContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string | undefined,
    runId: locals.runId as string | undefined,
    campaignId: locals.campaignId as string | undefined,
    brandIds: (locals.brandIds as string[]) || [],
    featureSlug: locals.featureSlug as string | undefined,
    workflowSlug: locals.workflowSlug as string | undefined,
    audienceId: locals.audienceId as string | undefined,
  };
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
  if (ctx.audienceId) headers["x-audience-id"] = ctx.audienceId;
  return headers;
}
