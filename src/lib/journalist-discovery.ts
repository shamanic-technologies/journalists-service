import { db, sql as pgClient } from "../db/index.js";
import { journalists, campaignJournalists } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import {
  discoverOutletArticles,
  type DiscoveredArticle,
} from "./articles-client.js";
import { chatComplete } from "./chat-client.js";
import type { OrgContext } from "./service-context.js";

// ── Types ────────────────────────────────────────────────────────────

export interface LlmJournalist {
  existingJournalistId?: string;
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
  existingJournalists: Array<{ id: string; journalistName: string }>,
  ctx: OrgContext
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
      provider: "google",
      model: "flash-lite",
      systemPrompt: `You are a PR research analyst. Score journalists' relevance to a brand based on their published articles.

Rules:
- Only keep HUMAN individual journalists (skip organizations, editorial teams, news desks, "Staff", "Admin", etc.)
- Score relevance using these three tiers:
  * 70-100 "Direct fit": the journalist actively covers the brand's sector, industry, or core topics
  * 30-70 "Adjacent": not a direct fit, but there is an angle that could interest the journalist
  * 0-30 "Distant": no meaningful connection between the journalist's coverage and the brand
- Provide a concise explanation for the relevance score (whyRelevant) and what might make them less relevant (whyNotRelevant)
- Include the article URLs where each journalist was found`,
      message: `Brand: ${brandName}
Description: ${truncate(brandDescription, 500)}

Campaign context:
${campaignContext || "(none specified)"}

Known journalists at this outlet (match authors to these if they are the same person — same person may have abbreviated names, initials, or slight spelling variations):
${existingJournalists.map(j => `- id="${j.id}" name="${j.journalistName}"`).join('\n')}

Journalists found on this outlet:
${authorsText}

Score each journalist using the three-tier scale (70-100 direct fit, 30-70 adjacent, 0-30 distant). Filter out non-human entities.

For each journalist, if they match a known journalist, include "existingJournalistId" with the id.
Always include "firstName" and "lastName" with the MOST COMPLETE version of the name (e.g., prefer "Samantha" over "S.", prefer full last names over abbreviations).

Return JSON:
{
  "journalists": [
    {
      "existingJournalistId": "optional - id of matched known journalist",
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
  brandIds: string[],
  featureSlug: string | null,
  workflowSlug: string | null = null,
  runId: string | null = null
): Promise<StoredJournalist[]> {
  const stored: StoredJournalist[] = [];

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const j of llmJournalists) {
    const journalistName = `${j.firstName} ${j.lastName}`;

    let journalistId = "";
    let isNew = false;
    let matched = false;

    // If LLM matched to an existing journalist, use that directly
    // Guard: LLM sometimes returns labels like "Journalist 1" instead of a UUID
    if (j.existingJournalistId && UUID_RE.test(j.existingJournalistId)) {
      const existingById = await db
        .select()
        .from(journalists)
        .where(eq(journalists.id, j.existingJournalistId));
      if (existingById.length > 0) {
        journalistId = existingById[0].id;
        isNew = false;
        matched = true;
        // Still enrich the name to the most complete version
        const newFirstName = (j.firstName.length > (existingById[0].firstName?.length ?? 0)) ? j.firstName : existingById[0].firstName;
        const newLastName = (j.lastName.length > (existingById[0].lastName?.length ?? 0)) ? j.lastName : existingById[0].lastName;
        const newJournalistName = `${newFirstName} ${newLastName}`;
        if (newFirstName !== existingById[0].firstName || newLastName !== existingById[0].lastName) {
          await db
            .update(journalists)
            .set({
              firstName: newFirstName,
              lastName: newLastName,
              journalistName: newJournalistName,
              updatedAt: new Date(),
            })
            .where(eq(journalists.id, journalistId));
        }
      }
    }

    if (!matched) {
      // Journalist identity is global: unique per (outlet, name, entity_type)
      // Case-insensitive lookup to prevent "Samantha McLean" vs "Samantha Mclean" duplicates
      const existing = await db
        .select()
        .from(journalists)
        .where(
          and(
            eq(journalists.outletId, outletId),
            sql`lower(${journalists.journalistName}) = lower(${journalistName})`,
            eq(journalists.entityType, "individual")
          )
        );

      if (existing.length > 0) {
        journalistId = existing[0].id;
        // Always enrich with the most complete name
        const newFirstName = (j.firstName.length > (existing[0].firstName?.length ?? 0)) ? j.firstName : existing[0].firstName;
        const newLastName = (j.lastName.length > (existing[0].lastName?.length ?? 0)) ? j.lastName : existing[0].lastName;
        const newJournalistName = `${newFirstName} ${newLastName}`;
        if (newFirstName !== existing[0].firstName || newLastName !== existing[0].lastName) {
          await db
            .update(journalists)
            .set({
              firstName: newFirstName,
              lastName: newLastName,
              journalistName: newJournalistName,
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
    }

    // Campaign scoring — status defaults to 'buffered'
    await db
      .insert(campaignJournalists)
      .values({
        journalistId,
        orgId,
        brandIds,
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
  brandIds: string[];
  ctx: OrgContext;
  runId?: string | null;
}): Promise<number> {
  const articlesResponse = await discoverOutletArticles(
    opts.outletDomain,
    opts.maxArticles,
    opts.ctx
  );

  const authors = groupArticlesByAuthor(articlesResponse.articles);

  const existingAtOutlet = await db
    .select({ id: journalists.id, journalistName: journalists.journalistName })
    .from(journalists)
    .where(eq(journalists.outletId, opts.outletId));

  const llmJournalists = await scoreJournalists(
    authors,
    opts.brandName,
    opts.brandDescription,
    opts.featureInputs,
    existingAtOutlet,
    opts.ctx
  );

  const stored = await storeJournalists(
    llmJournalists,
    opts.outletId,
    opts.campaignId,
    opts.orgId,
    opts.brandIds,
    opts.ctx.featureSlug ?? null,
    opts.ctx.workflowSlug ?? null,
    opts.runId ?? null
  );

  return stored.length;
}
