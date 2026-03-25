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
import {
  discoverOutletArticles,
  type DiscoveredArticle,
} from "../lib/articles-client.js";
import { chatComplete } from "../lib/chat-client.js";
import { DiscoverJournalistsSchema } from "../schemas.js";

const router = Router();

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

interface LlmJournalist {
  firstName: string;
  lastName: string;
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: string[];
}

// ── Build author-article map from articles-service response ─────────

interface AuthorWithArticles {
  firstName: string;
  lastName: string;
  articles: Array<{
    url: string;
    title: string | null;
    publishedAt: string | null;
  }>;
}

function groupArticlesByAuthor(
  articles: DiscoveredArticle[]
): AuthorWithArticles[] {
  const authorMap = new Map<string, AuthorWithArticles>();

  for (const article of articles) {
    for (const author of article.authors) {
      if (!author.firstName || !author.lastName) continue;

      const key = `${author.firstName.toLowerCase()} ${author.lastName.toLowerCase()}`;
      const existing = authorMap.get(key);

      if (existing) {
        existing.articles.push({
          url: article.url,
          title: article.title,
          publishedAt: article.publishedAt,
        });
      } else {
        authorMap.set(key, {
          firstName: author.firstName,
          lastName: author.lastName,
          articles: [
            {
              url: article.url,
              title: article.title,
              publishedAt: article.publishedAt,
            },
          ],
        });
      }
    }
  }

  return Array.from(authorMap.values());
}

// ── Score journalists via LLM ───────────────────────────────────────

async function scoreJournalists(
  authors: AuthorWithArticles[],
  brandName: string,
  brandDescription: string,
  featureInputs: Record<string, string>,
  orgId: string,
  userId: string,
  runId: string,
  featureSlug: string | null
): Promise<LlmJournalist[]> {
  if (authors.length === 0) return [];

  const featureContext = Object.entries(featureInputs)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const authorsText = authors
    .map(
      (a, i) =>
        `Journalist ${i + 1}: ${a.firstName} ${a.lastName}
Articles (${a.articles.length}):
${a.articles.map((art) => `  - "${art.title || "(untitled)"}" (${art.publishedAt || "date unknown"}) ${art.url}`).join("\n")}
---`
    )
    .join("\n");

  const response = await chatComplete(
    {
      systemPrompt: `You are a PR research analyst. Score journalists' relevance to a brand based on their published articles.

Rules:
- Only keep HUMAN individual journalists (skip organizations, editorial teams, news desks, "Staff", "Admin", etc.)
- Score relevance from 0-100 based on how well the journalist's coverage aligns with the brand
- Provide a concise explanation for the relevance score (whyRelevant) and what might make them less relevant (whyNotRelevant)
- Include the article URLs where each journalist was found`,
      message: `Brand: ${brandName}
Description: ${truncate(brandDescription, 500)}

Search criteria:
${featureContext || "(none specified)"}

Journalists found on this outlet:
${authorsText}

Score each journalist's relevance to the brand (0-100). Filter out non-human entities.

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

  const parsed = response.json as
    | { journalists?: LlmJournalist[] }
    | undefined;
  if (!parsed?.journalists || !Array.isArray(parsed.journalists)) {
    return [];
  }

  return parsed.journalists.filter(
    (j) =>
      j.firstName &&
      j.lastName &&
      typeof j.relevanceScore === "number" &&
      j.relevanceScore >= 0 &&
      j.relevanceScore <= 100
  );
}

// ── Store journalists in DB ─────────────────────────────────────────

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

    // Link to outlet
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
    const outletDomain = extractDomain(outlet.outletUrl);

    // Step 1: Discover articles + authors via articles-service
    const articlesResponse = await discoverOutletArticles(
      outletDomain,
      maxArticles,
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Step 2: Group articles by author
    const authors = groupArticlesByAuthor(articlesResponse.articles);

    // Step 3: Score journalists via LLM
    const llmJournalists = await scoreJournalists(
      authors,
      brandName,
      brandDescription,
      featureInputs,
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Step 4: Store in DB
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
      totalArticlesSearched: articlesResponse.articles.length,
      totalNamesExtracted: authors.length,
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
