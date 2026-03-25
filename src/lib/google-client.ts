const GOOGLE_SERVICE_URL = process.env.GOOGLE_SERVICE_URL;
const GOOGLE_SERVICE_API_KEY = process.env.GOOGLE_SERVICE_API_KEY;

function getConfig() {
  if (!GOOGLE_SERVICE_URL) throw new Error("GOOGLE_SERVICE_URL is not set");
  if (!GOOGLE_SERVICE_API_KEY) throw new Error("GOOGLE_SERVICE_API_KEY is not set");
  return { url: GOOGLE_SERVICE_URL, apiKey: GOOGLE_SERVICE_API_KEY };
}

export interface SearchQuery {
  query: string;
  type: "web" | "news";
  num?: number;
  gl?: string;
  hl?: string;
}

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
  domain: string;
  position: number;
}

export interface NewsSearchResult {
  title: string;
  link: string;
  snippet: string;
  source: string;
  date: string;
  domain: string;
}

export type SearchResult = WebSearchResult | NewsSearchResult;

export interface BatchSearchResponse {
  results: Array<{
    query: string;
    type: "web" | "news";
    results: SearchResult[];
  }>;
}

export async function batchSearch(
  queries: SearchQuery[],
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null = null
): Promise<BatchSearchResponse> {
  const { url, apiKey } = getConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-org-id": orgId,
    "x-user-id": userId,
    "x-run-id": runId,
  };
  if (featureSlug) headers["x-feature-slug"] = featureSlug;

  const response = await fetch(`${url}/search/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ queries }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google service POST /search/batch failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<BatchSearchResponse>;
}
