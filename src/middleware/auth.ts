import { Request, Response, NextFunction } from "express";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey || apiKey !== process.env.JOURNALISTS_SERVICE_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function requireIdentityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const orgId = req.headers["x-org-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  const runId = req.headers["x-run-id"] as string | undefined;

  if (!orgId) {
    res.status(400).json({ error: "x-org-id header is required" });
    return;
  }
  if (!userId) {
    res.status(400).json({ error: "x-user-id header is required" });
    return;
  }
  if (!runId) {
    res.status(400).json({ error: "x-run-id header is required" });
    return;
  }

  const featureSlug = req.headers["x-feature-slug"] as string | undefined;
  const campaignId = req.headers["x-campaign-id"] as string | undefined;
  const brandId = req.headers["x-brand-id"] as string | undefined;
  const workflowName = req.headers["x-workflow-name"] as string | undefined;

  res.locals.orgId = orgId;
  res.locals.userId = userId;
  res.locals.runId = runId;
  res.locals.featureSlug = featureSlug ?? null;
  res.locals.campaignId = campaignId ?? null;
  res.locals.brandId = brandId ?? null;
  res.locals.workflowName = workflowName ?? null;
  next();
}
