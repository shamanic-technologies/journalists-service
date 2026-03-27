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

// ── Score a single journalist via LLM ────────────────────────────────

export async function scoreSingleJournalist(
  author: AuthorWithArticles,
  brandName: string,
  brandDescription: string,
  featureInputs: Record<string, string>,
  ctx: ServiceContext
): Promise<LlmJournalist | null> {
  const campaignContext = Object.entries(featureInputs)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const articlesText = author.articles
    .map(
      (art) =>
        `  - "${art.title || "(untitled)"}" (${art.publishedAt || "date unknown"}) ${art.url}`
    )
    .join("\n");

  const response = await chatComplete(
    {
      systemPrompt: `You are a PR research analyst. Score a journalist's relevance to a brand based on their published articles.

Rules:
- If this is NOT a real human journalist (e.g. organization, editorial team, news desk, "Staff", "Admin"), return {"skip": true}
- Score relevance from 0-100 based on how well the journalist's coverage aligns with the brand
- Provide a concise explanation for the relevance score (whyRelevant) and what might make them less relevant (whyNotRelevant)
- Include the article URLs provided`,
      message: `Brand: ${brandName}
Description: ${truncate(brandDescription, 500)}

Campaign context:
${campaignContext || "(none specified)"}

Journalist: ${author.firstName} ${author.lastName}
Articles (${author.articles.length}):
${articlesText}

Score this journalist's relevance to the brand (0-100).

Return JSON (one of):
{"skip": true}
OR
{
  "firstName": "string",
  "lastName": "string",
  "relevanceScore": number (0-100),
  "whyRelevant": "string",
  "whyNotRelevant": "string",
  "articleUrls": ["url1", "url2"]
}`,
      responseFormat: "json",
      temperature: 0.2,
      maxTokens: 2000,
    },
    ctx
  );

  const parsed = response.json as Record<string, unknown> | undefined;
  if (!parsed || parsed.skip) return null;

  const j = parsed as unknown as LlmJournalist;
  if (
    !j.firstName ||
    !j.lastName ||
    typeof j.relevanceScore !== "number" ||
    j.relevanceScore < 0 ||
    j.relevanceScore > 100
  ) {
    return null;
  }

  return j;
}

// ── Store journalists in DB ──────────────────────────────────────────

export async function storeJournalists(
  llmJournalists: LlmJournalist[],
  outletId: string,
  campaignId: string,
  orgId: string,
  brandId: string,
  featureSlug: string | null
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

    // Campaign scoring is scoped
    await db
      .insert(campaignJournalists)
      .values({
        journalistId,
        orgId,
        brandId,
        featureSlug,
        campaignId,
        outletId,
        relevanceScore: String(j.relevanceScore),
        whyRelevant: j.whyRelevant,
        whyNotRelevant: j.whyNotRelevant,
        articleUrls: j.articleUrls || [],
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

// ── Full discover + score pipeline ───────────────────────────────────

export async function discoverAndScoreJournalists(opts: {
  outletDomain: string;
  outletId: string;
  campaignId: string;
  brandName: string;
  brandDescription: string;
  featureInputs: Record<string, string>;
  maxArticles: number;
  count: number;
  acceptanceThreshold: number;
  orgId: string;
  brandId: string;
  ctx: ServiceContext;
}): Promise<StoredJournalist[]> {
  const articlesResponse = await discoverOutletArticles(
    opts.outletDomain,
    opts.maxArticles,
    opts.ctx
  );

  const authors = groupArticlesByAuthor(articlesResponse.articles);

  // Sort by article count descending — most prolific authors first (better signal, more likely relevant)
  authors.sort((a, b) => b.articles.length - a.articles.length);

  const accepted: LlmJournalist[] = [];
  const scored: LlmJournalist[] = [];

  for (const author of authors) {
    const result = await scoreSingleJournalist(
      author,
      opts.brandName,
      opts.brandDescription,
      opts.featureInputs,
      opts.ctx
    );

    if (!result) continue;

    scored.push(result);

    if (result.relevanceScore >= opts.acceptanceThreshold) {
      accepted.push(result);
      if (accepted.length >= opts.count) break;
    }
  }

  const stored = await storeJournalists(
    scored,
    opts.outletId,
    opts.campaignId,
    opts.orgId,
    opts.brandId,
    opts.ctx.featureSlug
  );

  stored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return stored;
}
