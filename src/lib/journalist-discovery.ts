import { db } from "../db/index.js";
import { journalists, campaignJournalists } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import {
  discoverOutletArticles,
  type DiscoveredArticle,
} from "./articles-client.js";
import { chatComplete } from "./chat-client.js";
import type { ServiceContext } from "./service-context.js";

// ── Types ────────────────────────────────────────────────────────────

export interface LlmJournalist {
  firstName: string;
  lastName: string;
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: string[];
}

export interface AuthorWithArticles {
  firstName: string;
  lastName: string;
  articles: Array<{
    url: string;
    title: string | null;
    publishedAt: string | null;
  }>;
}

export interface StoredJournalist {
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

// ── Helpers ──────────────────────────────────────────────────────────

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

// ── Group articles by author ─────────────────────────────────────────

export function groupArticlesByAuthor(
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

// ── Score journalists via LLM (batch) ────────────────────────────────

export async function scoreJournalists(
  authors: AuthorWithArticles[],
  brandName: string,
  brandDescription: string,
  featureInputs: Record<string, string>,
  ctx: ServiceContext
): Promise<LlmJournalist[]> {
  if (authors.length === 0) return [];

  const campaignContext = Object.entries(featureInputs)
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

Campaign context:
${campaignContext || "(none specified)"}

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
    ctx
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

// ── Store journalists in DB (as buffered) ────────────────────────────

export async function storeJournalists(
  llmJournalists: LlmJournalist[],
  outletId: string,
  campaignId: string,
  orgId: string,
  brandId: string,
  featureSlug: string | null,
  workflowSlug: string | null = null,
  runId: string | null = null
): Promise<StoredJournalist[]> {
  const stored: StoredJournalist[] = [];

  for (const j of llmJournalists) {
    const journalistName = `${j.firstName} ${j.lastName}`;

    // Journalist identity is global: unique per (outlet, name, entity_type)
    const existing = await db
      .select()
      .from(journalists)
      .where(
        and(
          eq(journalists.outletId, outletId),
          eq(journalists.journalistName, journalistName),
          eq(journalists.entityType, "individual")
        )
      );

    let journalistId: string;
    let isNew = false;

    if (existing.length > 0) {
      journalistId = existing[0].id;
      if (!existing[0].firstName || !existing[0].lastName) {
        await db
          .update(journalists)
          .set({
            firstName: j.firstName,
            lastName: j.lastName,
            updatedAt: new Date(),
          })
          .where(eq(journalists.id, journalistId));
      }
    } else {
      const [created] = await db
        .insert(journalists)
        .values({
          outletId,
          entityType: "individual",
          journalistName,
          firstName: j.firstName,
          lastName: j.lastName,
        })
        .returning();
      journalistId = created.id;
      isNew = true;
    }

    // Campaign scoring — status defaults to 'buffered'
    await db
      .insert(campaignJournalists)
      .values({
        journalistId,
        orgId,
        brandId,
        featureSlug,
        workflowSlug,
        campaignId,
        outletId,
        relevanceScore: String(j.relevanceScore),
        whyRelevant: j.whyRelevant,
        whyNotRelevant: j.whyNotRelevant,
        articleUrls: j.articleUrls || [],
        runId,
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

// ── Refill buffer: discover + score + store as buffered ──────────────

export async function refillBuffer(opts: {
  outletDomain: string;
  outletId: string;
  campaignId: string;
  brandName: string;
  brandDescription: string;
  featureInputs: Record<string, string>;
  maxArticles: number;
  orgId: string;
  brandId: string;
  ctx: ServiceContext;
  runId?: string | null;
}): Promise<number> {
  const articlesResponse = await discoverOutletArticles(
    opts.outletDomain,
    opts.maxArticles,
    opts.ctx
  );

  const authors = groupArticlesByAuthor(articlesResponse.articles);

  const llmJournalists = await scoreJournalists(
    authors,
    opts.brandName,
    opts.brandDescription,
    opts.featureInputs,
    opts.ctx
  );

  const stored = await storeJournalists(
    llmJournalists,
    opts.outletId,
    opts.campaignId,
    opts.orgId,
    opts.brandId,
    opts.ctx.featureSlug,
    opts.ctx.workflowSlug,
    opts.runId ?? null
  );

  return stored.length;
}
