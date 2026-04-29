const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL;
const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY;

interface DynastyEntry {
  workflowDynastySlug: string;
  workflowSlugs: string[];
}

function getConfig(): { url: string; apiKey: string } {
  if (!WORKFLOW_SERVICE_URL) throw new Error("WORKFLOW_SERVICE_URL is not set");
  if (!WORKFLOW_SERVICE_API_KEY) throw new Error("WORKFLOW_SERVICE_API_KEY is not set");
  return { url: WORKFLOW_SERVICE_URL, apiKey: WORKFLOW_SERVICE_API_KEY };
}

function buildHeaders(
  apiKey: string,
  context?: { orgId?: string; userId?: string; runId?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };
  if (context?.orgId) headers["x-org-id"] = context.orgId;
  if (context?.userId) headers["x-user-id"] = context.userId;
  if (context?.runId) headers["x-run-id"] = context.runId;
  return headers;
}

/**
 * Resolve a workflow dynasty slug to its list of versioned workflow slugs.
 * Returns empty array if resolution fails or dynasty doesn't exist.
 */
export async function resolveWorkflowDynastySlugs(
  dynastySlug: string,
  context?: { orgId?: string; userId?: string; runId?: string },
): Promise<string[]> {
  try {
    const { url, apiKey } = getConfig();
    const res = await fetch(
      `${url}/workflows/dynasty/slugs?dynastySlug=${encodeURIComponent(dynastySlug)}`,
      { headers: buildHeaders(apiKey, context), signal: AbortSignal.timeout(300_000) },
    );
    if (!res.ok) {
      console.warn(`[journalists-service] Failed to resolve workflow dynasty slug ${dynastySlug}: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { workflowSlugs: string[] };
    return data.workflowSlugs ?? [];
  } catch (error) {
    console.error("[journalists-service] Error resolving workflow dynasty slug:", error);
    return [];
  }
}

/**
 * Fetch all workflow dynasties and build a reverse map: workflowSlug → dynastySlug.
 */
export async function fetchWorkflowDynastyMap(
  context?: { orgId?: string; userId?: string; runId?: string },
): Promise<Map<string, string>> {
  try {
    const { url, apiKey } = getConfig();
    const res = await fetch(`${url}/workflows/dynasties`, {
      headers: buildHeaders(apiKey, context),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      console.warn(`[journalists-service] Failed to fetch workflow dynasties: ${res.status}`);
      return new Map();
    }
    const data = (await res.json()) as { dynasties: DynastyEntry[] };
    const map = new Map<string, string>();
    for (const d of data.dynasties ?? []) {
      for (const slug of d.workflowSlugs) {
        map.set(slug, d.workflowDynastySlug);
      }
    }
    return map;
  } catch (error) {
    console.error("[journalists-service] Error fetching workflow dynasties:", error);
    return new Map();
  }
}
