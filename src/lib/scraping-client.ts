const SCRAPING_SERVICE_URL = process.env.SCRAPING_SERVICE_URL;
const SCRAPING_SERVICE_API_KEY = process.env.SCRAPING_SERVICE_API_KEY;

function getConfig() {
  if (!SCRAPING_SERVICE_URL) throw new Error("SCRAPING_SERVICE_URL is not set");
  if (!SCRAPING_SERVICE_API_KEY) throw new Error("SCRAPING_SERVICE_API_KEY is not set");
  return { url: SCRAPING_SERVICE_URL, apiKey: SCRAPING_SERVICE_API_KEY };
}

export interface ScrapeResult {
  id: string;
  url: string;
  companyName: string | null;
  description: string | null;
  rawMarkdown: string | null;
}

export interface ScrapeResponse {
  cached: boolean;
  result: ScrapeResult;
}

export async function scrapeUrl(
  articleUrl: string,
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null = null
): Promise<ScrapeResponse> {
  const { url, apiKey } = getConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-org-id": orgId,
    "x-user-id": userId,
    "x-run-id": runId,
  };
  if (featureSlug) headers["x-feature-slug"] = featureSlug;

  const response = await fetch(`${url}/scrape`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: articleUrl,
      sourceService: "journalists-service",
      options: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Scraping service POST /scrape failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<ScrapeResponse>;
}
