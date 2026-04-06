import { Request, Response, NextFunction } from "express";

const API_KEY_ENV = "JOURNALISTS_SERVICE_API_KEY";

// Crash at startup if the API key env var is missing
const apiKeyValue = process.env[API_KEY_ENV];
if (!apiKeyValue && process.env.NODE_ENV !== "test") {
  console.error(
    `[journalists-service] FATAL: ${API_KEY_ENV} env var is missing — refusing to start`
  );
  process.exit(1);
}

export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers["x-api-key"] as string;
  const expected = process.env[API_KEY_ENV];
  if (!apiKey || apiKey !== expected) {
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
 * Requires x-org-id. Parses all other identity headers as optional
 * and stores them in res.locals as an OrgContext shape.
 */
export function requireOrgId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const orgId = req.headers["x-org-id"] as string | undefined;

  if (!orgId) {
    console.warn(
      `[journalists-service] Missing required header x-org-id on ${req.method} ${req.path}`
    );
    res.status(400).json({ error: "Missing required header: x-org-id" });
    return;
  }

  res.locals.orgId = orgId;
  res.locals.userId = (req.headers["x-user-id"] as string) || undefined;
  res.locals.runId = (req.headers["x-run-id"] as string) || undefined;
  res.locals.campaignId = (req.headers["x-campaign-id"] as string) || undefined;
  res.locals.brandIds = parseBrandIds(req.headers["x-brand-id"] as string | undefined);
  res.locals.featureSlug = (req.headers["x-feature-slug"] as string) || undefined;
  res.locals.workflowSlug = (req.headers["x-workflow-slug"] as string) || undefined;
  next();
}
