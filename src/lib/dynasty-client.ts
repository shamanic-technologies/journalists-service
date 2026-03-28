const FEATURES_SERVICE_URL = process.env.FEATURES_SERVICE_URL;
const FEATURES_SERVICE_API_KEY = process.env.FEATURES_SERVICE_API_KEY;
const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL;
const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY;

interface DynastyEntry {
  dynastySlug: string;
  slugs: string[];
}

/** Resolve a feature dynasty slug to its list of versioned slugs */
export async function resolveFeatureDynastySlugs(
  dynastySlug: string,
  headers: Record<string, string>
): Promise<string[]> {
  if (!FEATURES_SERVICE_URL || !FEATURES_SERVICE_API_KEY) {
    throw new Error("FEATURES_SERVICE_URL / FEATURES_SERVICE_API_KEY not set");
  }

  const url = `${FEATURES_SERVICE_URL}/features/dynasty/slugs?dynastySlug=${encodeURIComponent(dynastySlug)}`;
  const res = await fetch(url, {
    headers: { "x-api-key": FEATURES_SERVICE_API_KEY, ...headers },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[journalists-service] features-service dynasty/slugs failed (${res.status}): ${body}`);
    return [];
  }

  const data = (await res.json()) as { slugs: string[] };
  return data.slugs ?? [];
}

/** Resolve a workflow dynasty slug to its list of versioned slugs */
export async function resolveWorkflowDynastySlugs(
  dynastySlug: string,
  headers: Record<string, string>
): Promise<string[]> {
  if (!WORKFLOW_SERVICE_URL || !WORKFLOW_SERVICE_API_KEY) {
    throw new Error("WORKFLOW_SERVICE_URL / WORKFLOW_SERVICE_API_KEY not set");
  }

  const url = `${WORKFLOW_SERVICE_URL}/workflows/dynasty/slugs?dynastySlug=${encodeURIComponent(dynastySlug)}`;
  const res = await fetch(url, {
    headers: { "x-api-key": WORKFLOW_SERVICE_API_KEY, ...headers },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[journalists-service] workflow-service dynasty/slugs failed (${res.status}): ${body}`);
    return [];
  }

  const data = (await res.json()) as { slugs: string[] };
  return data.slugs ?? [];
}

/** Fetch all feature dynasties and build a reverse map: slug -> dynastySlug */
export async function fetchFeatureDynasties(
  headers: Record<string, string>
): Promise<DynastyEntry[]> {
  if (!FEATURES_SERVICE_URL || !FEATURES_SERVICE_API_KEY) {
    throw new Error("FEATURES_SERVICE_URL / FEATURES_SERVICE_API_KEY not set");
  }

  const res = await fetch(`${FEATURES_SERVICE_URL}/features/dynasties`, {
    headers: { "x-api-key": FEATURES_SERVICE_API_KEY, ...headers },
  });

  if (!res.ok) {
    console.error(`[journalists-service] features-service /features/dynasties failed (${res.status})`);
    return [];
  }

  const data = (await res.json()) as { dynasties: DynastyEntry[] };
  return data.dynasties ?? [];
}

/** Fetch all workflow dynasties and build a reverse map: slug -> dynastySlug */
export async function fetchWorkflowDynasties(
  headers: Record<string, string>
): Promise<DynastyEntry[]> {
  if (!WORKFLOW_SERVICE_URL || !WORKFLOW_SERVICE_API_KEY) {
    throw new Error("WORKFLOW_SERVICE_URL / WORKFLOW_SERVICE_API_KEY not set");
  }

  const res = await fetch(`${WORKFLOW_SERVICE_URL}/workflows/dynasties`, {
    headers: { "x-api-key": WORKFLOW_SERVICE_API_KEY, ...headers },
  });

  if (!res.ok) {
    console.error(`[journalists-service] workflow-service /workflows/dynasties failed (${res.status})`);
    return [];
  }

  const data = (await res.json()) as { dynasties: DynastyEntry[] };
  return data.dynasties ?? [];
}

/** Build a reverse map: versioned slug -> dynasty slug */
export function buildSlugToDynastyMap(
  dynasties: DynastyEntry[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of dynasties) {
    for (const slug of d.slugs) {
      map.set(slug, d.dynastySlug);
    }
  }
  return map;
}
