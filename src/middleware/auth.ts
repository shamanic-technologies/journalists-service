import { Request, Response, NextFunction } from "express";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey || apiKey !== process.env.JOURNALISTS_SERVICE_API_KEY) {
    console.warn(
      `[journalists-service] Auth rejected ${req.method} ${req.path} — ` +
        (apiKey ? "api key mismatch" : "no x-api-key header")
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** Parse the x-brand-id header as CSV into a string[] of UUIDs */
function parseBrandIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * All authenticated endpoints require ALL 6 contextual headers.
 * Returns 400 listing which ones are missing.
 */
export function requireIdentityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const orgId = req.headers["x-org-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  const runId = req.headers["x-run-id"] as string | undefined;
  const campaignId = req.headers["x-campaign-id"] as string | undefined;
  const brandIdRaw = req.headers["x-brand-id"] as string | undefined;
  const featureSlug = req.headers["x-feature-slug"] as string | undefined;
  const workflowSlug = req.headers["x-workflow-slug"] as string | undefined;

  const missing = [
    !orgId && "x-org-id",
    !userId && "x-user-id",
    !runId && "x-run-id",
    !campaignId && "x-campaign-id",
    !brandIdRaw && "x-brand-id",
    !featureSlug && "x-feature-slug",
    !workflowSlug && "x-workflow-slug",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.warn(
      `[journalists-service] Missing required headers on ${req.method} ${req.path}: ${missing.join(", ")}`
    );
    res
      .status(400)
      .json({ error: `Missing required headers: ${missing.join(", ")}` });
    return;
  }

  const brandIds = parseBrandIds(brandIdRaw);

  res.locals.orgId = orgId;
  res.locals.userId = userId;
  res.locals.runId = runId;
  res.locals.campaignId = campaignId;
  res.locals.brandIds = brandIds;
  res.locals.featureSlug = featureSlug;
  res.locals.workflowSlug = workflowSlug;
  next();
}
