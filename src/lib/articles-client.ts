import { type OrgContext, buildServiceHeaders } from "./service-context.js";

const ARTICLES_SERVICE_URL = process.env.ARTICLES_SERVICE_URL;
const ARTICLES_SERVICE_API_KEY = process.env.ARTICLES_SERVICE_API_KEY;

function getConfig() {
  if (!ARTICLES_SERVICE_URL) throw new Error("ARTICLES_SERVICE_URL is not set");
  if (!ARTICLES_SERVICE_API_KEY)
    throw new Error("ARTICLES_SERVICE_API_KEY is not set");
  return { url: ARTICLES_SERVICE_URL, apiKey: ARTICLES_SERVICE_API_KEY };
}

export interface ArticleAuthor {
  firstName: string;
  lastName: string;
}

export interface DiscoveredArticle {
  url: string;
  title: string | null;
  snippet: string | null;
  publishedAt: string | null;
  authors: ArticleAuthor[];
}

export interface DiscoverOutletArticlesResponse {
  articles: DiscoveredArticle[];
}

export async function discoverOutletArticles(
  outletDomain: string,
  maxArticles: number,
  ctx: OrgContext
): Promise<DiscoverOutletArticlesResponse> {
  const { url, apiKey } = getConfig();

  const headers = {
    ...buildServiceHeaders(apiKey, ctx),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${url}/v1/discover/outlet-articles`, {
    method: "POST",
    headers,
    body: JSON.stringify({ outletDomain, maxArticles }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Articles service POST /v1/discover/outlet-articles failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<DiscoverOutletArticlesResponse>;
}
