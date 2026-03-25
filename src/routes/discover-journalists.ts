import { Router } from "express";
import { db } from "../db/index.js";
import {
  pressJournalists,
  outletJournalists,
  campaignOutletJournalists,
} from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { createChildRun } from "../lib/runs-client.js";
import { fetchBrand } from "../lib/brand-client.js";
import { fetchOutlet } from "../lib/outlets-client.js";
import { batchSearch, type SearchResult } from "../lib/google-client.js";
import { scrapeUrl } from "../lib/scraping-client.js";
import { chatComplete } from "../lib/chat-client.js";
import { DiscoverJournalistsSchema } from "../schemas.js";

const router = Router();

const MAX_SCRAPE_CONCURRENCY = 5;

// ── helpers ──────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function dedupeUrls(results: SearchResult[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const r of results) {
    if (!seen.has(r.link)) {
      seen.add(r.link);
      urls.push(r.link);
    }
  }
  return urls;
}

interface LlmJournalist {
  firstName: string;
  lastName: string;
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: string[];
}

// ── Step 1: generate search queries via LLM ─────────────────────────

async function generateSearchQueries(
  brandName: string,
  brandDescription: string,
  outletName: string,
  outletDomain: string,
  featureInputs: Record<string, string>,
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null
): Promise<Array<{ query: string; type: "web" | "news" }>> {
  const featureContext = Object.entries(featureInputs)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const response = await chatComplete(
    {
      systemPrompt: `You are a PR research assistant. Generate Google search queries to find articles and their journalist authors on a specific media outlet that are relevant for a brand. Return JSON.`,
      message: `Brand: ${brandName}
Description: ${truncate(brandDescription, 500)}
Outlet: ${outletName} (domain: ${outletDomain})

Feature search criteria:
${featureContext || "(none specified)"}

Generate 4-6 search queries to find articles on this outlet relevant to this brand. Use "site:${outletDomain}" prefix for web queries. Include 1-2 news queries (without site: prefix, using the outlet name).

Return JSON: { "queries": [{ "query": "...", "type": "web" | "news" }] }`,
      responseFormat: "json",
      temperature: 0.3,
      maxTokens: 1000,
    },
    orgId,
    userId,
    runId,
    featureSlug
  );

  const parsed = response.json as { queries?: Array<{ query: string; type: "web" | "news" }> } | undefined;
  if (!parsed?.queries || !Array.isArray(parsed.queries)) {
    // Fallback: build queries programmatically
    return [
      { query: `site:${outletDomain} ${brandName}`, type: "web" },
      { query: `site:${outletDomain} ${brandDescription.split(" ").slice(0, 5).join(" ")}`, type: "web" },
      { query: `${outletName} ${brandName}`, type: "news" },
    ];
  }

  return parsed.queries.slice(0, 8);
}

// ── Step 2: scrape articles in parallel (with concurrency limit) ────

interface ScrapedArticle {
  url: string;
  title: string;
  snippet: string;
  content: string; // first ~1500 chars of markdown
}

async function scrapeArticles(
  urls: string[],
  searchResults: SearchResult[],
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null
): Promise<ScrapedArticle[]> {
  const articles: ScrapedArticle[] = [];

  // Build a map from URL to search result for title/snippet fallback
  const resultByUrl = new Map<string, SearchResult>();
  for (const r of searchResults) {
    resultByUrl.set(r.link, r);
  }

  // Process in batches of MAX_SCRAPE_CONCURRENCY
  for (let i = 0; i < urls.length; i += MAX_SCRAPE_CONCURRENCY) {
    const batch = urls.slice(i, i + MAX_SCRAPE_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((url) => scrapeUrl(url, orgId, userId, runId, featureSlug))
    );

    for (let j = 0; j < batch.length; j++) {
      const url = batch[j];
      const result = results[j];
      const searchHit = resultByUrl.get(url);

      if (result.status === "fulfilled" && result.value.result.rawMarkdown) {
        articles.push({
          url,
          title: searchHit?.title ?? "",
          snippet: searchHit?.snippet ?? "",
          content: truncate(result.value.result.rawMarkdown, 1500),
        });
      } else if (searchHit) {
        // Fallback: use search snippet even if scrape failed
        articles.push({
          url,
          title: searchHit.title,
          snippet: searchHit.snippet,
          content: "",
        });
      }
    }
  }

  return articles;
}

// ── Step 3: extract + score journalists via LLM ─────────────────────

async function extractAndScoreJournalists(
  articles: ScrapedArticle[],
  brandName: string,
  brandDescription: string,
  featureInputs: Record<string, string>,
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null
): Promise<LlmJournalist[]> {
  if (articles.length === 0) return [];

  const featureContext = Object.entries(featureInputs)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const articlesText = articles
    .map(
      (a, i) =>
        `Article ${i + 1}:
URL: ${a.url}
Title: ${a.title}
Snippet: ${a.snippet}
Content excerpt: ${a.content || "(scraping failed)"}
---`
    )
    .join("\n");

  const response = await chatComplete(
    {
      systemPrompt: `You are a PR research analyst. Your job is to identify HUMAN journalists (real people with first name + last name) from article bylines and metadata, then score their relevance to a brand.

Rules:
- Only extract HUMAN individual journalists (not organizations, editorial teams, news desks, "Staff", "Admin", etc.)
- Each journalist must have a clear first name and last name
- Deduplicate: if the same journalist appears in multiple articles, merge them
- Score relevance from 0-100 based on how well the journalist's coverage aligns with the brand
- Provide a concise explanation for the relevance score (whyRelevant) and what might make them less relevant (whyNotRelevant)
- Include the article URLs where each journalist was found`,
      message: `Brand: ${brandName}
Description: ${truncate(brandDescription, 500)}

Search criteria:
${featureContext || "(none specified)"}

Articles to analyze:
${articlesText}

Extract all human journalists from these articles. Score each journalist's relevance to the brand (0-100).

Return JSON:
{
  "journalists": [
    {
      "firstName": "string",
      "lastName": "string",
      "relevanceScore": number (0-100),
      "whyRelevant": "string - why this journalist is relevant",
      "whyNotRelevant": "string - potential concerns or reasons for lower score",
      "articleUrls": ["url1", "url2"]
    }
  ]
}`,
      responseFormat: "json",
      temperature: 0.2,
      maxTokens: 8000,
    },
    orgId,
    userId,
    runId,
    featureSlug
  );

  const parsed = response.json as { journalists?: LlmJournalist[] } | undefined;
  if (!parsed?.journalists || !Array.isArray(parsed.journalists)) {
    return [];
  }

  // Filter out invalid entries
  return parsed.journalists.filter(
    (j) =>
      j.firstName &&
      j.lastName &&
      typeof j.relevanceScore === "number" &&
      j.relevanceScore >= 0 &&
      j.relevanceScore <= 100
  );
}

// ── Step 4: store journalists in DB ─────────────────────────────────

interface StoredJournalist {
  id: string;
  journalistName: string;
  firstName: string;
  lastName: string;
  entityType: "individual";
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: string[];
  isNew: boolean;
}

async function storeJournalists(
  journalists: LlmJournalist[],
  outletId: string,
  campaignId: string,
  featureSlug: string | null
): Promise<StoredJournalist[]> {
  const stored: StoredJournalist[] = [];

  for (const j of journalists) {
    const journalistName = `${j.firstName} ${j.lastName}`;

    // Upsert press_journalists
    const existing = await db
      .select()
      .from(pressJournalists)
      .where(
        and(
          eq(pressJournalists.journalistName, journalistName),
          eq(pressJournalists.entityType, "individual")
        )
      );

    let journalistId: string;
    let isNew = false;

    if (existing.length > 0) {
      journalistId = existing[0].id;
      // Update firstName/lastName if previously null
      if (!existing[0].firstName || !existing[0].lastName) {
        await db
          .update(pressJournalists)
          .set({
            firstName: j.firstName,
            lastName: j.lastName,
            updatedAt: new Date(),
          })
          .where(eq(pressJournalists.id, journalistId));
      }
    } else {
      const [created] = await db
        .insert(pressJournalists)
        .values({
          entityType: "individual",
          journalistName,
          firstName: j.firstName,
          lastName: j.lastName,
        })
        .returning();
      journalistId = created.id;
      isNew = true;
    }

    // Link to outlet (ignore if already linked)
    await db
      .insert(outletJournalists)
      .values({ outletId, journalistId })
      .onConflictDoNothing();

    // Upsert campaign-outlet-journalist with relevance
    await db
      .insert(campaignOutletJournalists)
      .values({
        campaignId,
        outletId,
        journalistId,
        featureSlug,
        whyRelevant: j.whyRelevant,
        whyNotRelevant: j.whyNotRelevant,
        relevanceScore: String(j.relevanceScore),
      })
      .onConflictDoNothing();

    stored.push({
      id: journalistId,
      journalistName,
      firstName: j.firstName,
      lastName: j.lastName,
      entityType: "individual",
      relevanceScore: j.relevanceScore,
      whyRelevant: j.whyRelevant,
      whyNotRelevant: j.whyNotRelevant,
      articleUrls: j.articleUrls || [],
      isNew,
    });
  }

  return stored;
}

// ── Route handler ───────────────────────────────────────────────────

router.post("/journalists/discover", async (req, res) => {
  const parsed = DiscoverJournalistsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, brandId, campaignId, featureInputs, maxArticles } =
    parsed.data;

  const orgId = res.locals.orgId as string;
  const userId = res.locals.userId as string;
  const runId = res.locals.runId as string;
  const featureSlug = res.locals.featureSlug as string | null;

  try {
    // Create child run
    const { run: childRun } = await createChildRun(
      {
        parentRunId: runId,
        service: "journalists-service",
        operation: "discover-journalists",
      },
      orgId,
      userId,
      featureSlug
    );
    const childRunId = childRun.id;

    // Fetch brand + outlet in parallel
    const [brand, outlet] = await Promise.all([
      fetchBrand(brandId, orgId, userId, childRunId, featureSlug),
      fetchOutlet(outletId, orgId, userId, childRunId, featureSlug),
    ]);

    const brandName = brand.name || "Unknown Brand";
    const brandDescription = [brand.elevatorPitch, brand.bio, brand.mission]
      .filter(Boolean)
      .join(". ");
    const outletName = outlet.outletName;
    const outletDomain = extractDomain(outlet.outletUrl);

    // Step 1: Generate search queries via LLM
    const searchQueries = await generateSearchQueries(
      brandName,
      brandDescription,
      outletName,
      outletDomain,
      featureInputs,
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Step 2: Execute batch Google search
    const searchResponse = await batchSearch(
      searchQueries.map((q) => ({ ...q, num: 10 })),
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Collect and deduplicate all search results
    const allResults: SearchResult[] = [];
    for (const batch of searchResponse.results) {
      allResults.push(...batch.results);
    }
    const articleUrls = dedupeUrls(allResults).slice(0, maxArticles);

    // Step 3: Scrape articles
    const articles = await scrapeArticles(
      articleUrls,
      allResults,
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Step 4: Extract and score journalists via LLM
    const llmJournalists = await extractAndScoreJournalists(
      articles,
      brandName,
      brandDescription,
      featureInputs,
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Step 5: Store in DB
    const stored = await storeJournalists(
      llmJournalists,
      outletId,
      campaignId,
      featureSlug
    );

    // Sort by relevance score descending
    stored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    res.json({
      journalists: stored,
      totalArticlesSearched: articles.length,
      totalNamesExtracted: llmJournalists.length,
      totalJournalistsStored: stored.length,
    });
  } catch (err) {
    console.error("Discover journalists error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
