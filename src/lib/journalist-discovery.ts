import { db, sql as pgClient } from "../db/index.js";
import { journalists, campaignJournalists, outletScrapeCache } from "../db/schema.js";
import { eq, and, sql, arrayContains } from "drizzle-orm";
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
          try {
            await db
              .update(journalists)
              .set({
                firstName: newFirstName,
                lastName: newLastName,
                journalistName: newJournalistName,
                updatedAt: new Date(),
              })
              .where(eq(journalists.id, journalistId));
          } catch (err: unknown) {
            // Unique constraint violation — enriched name collides with another journalist at same outlet
            if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
              console.log(
                `[journalists-service] Name enrichment skipped — "${newJournalistName}" already exists at outlet ${outletId}`
              );
            } else {
              throw err;
            }
          }
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
          try {
            await db
              .update(journalists)
              .set({
                firstName: newFirstName,
                lastName: newLastName,
                journalistName: newJournalistName,
                updatedAt: new Date(),
              })
              .where(eq(journalists.id, journalistId));
          } catch (err: unknown) {
            if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
              console.log(
                `[journalists-service] Name enrichment skipped — "${newJournalistName}" already exists at outlet ${outletId}`
              );
            } else {
              throw err;
            }
          }
        }
      } else {
        // Upsert: concurrent refills for the same outlet can race here
        const [upserted] = await db
          .insert(journalists)
          .values({
            outletId,
            entityType: "individual",
            journalistName,
            firstName: j.firstName,
            lastName: j.lastName,
          })
          .onConflictDoUpdate({
            target: [journalists.outletId, journalists.journalistName, journalists.entityType],
            set: {
              firstName: sql`CASE WHEN length(excluded.first_name) > length(COALESCE(${journalists.firstName}, '')) THEN excluded.first_name ELSE ${journalists.firstName} END`,
              lastName: sql`CASE WHEN length(excluded.last_name) > length(COALESCE(${journalists.lastName}, '')) THEN excluded.last_name ELSE ${journalists.lastName} END`,
              updatedAt: new Date(),
            },
          })
          .returning();
        journalistId = upserted.id;
        isNew = !upserted.updatedAt || upserted.createdAt.getTime() === upserted.updatedAt.getTime();
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

// ── Scrape cache ────────────────────────────────────────────────────

const SCRAPE_CACHE_MAX_AGE_MS = 3 * 30 * 24 * 60 * 60 * 1000; // ~3 months

async function isScrapeCacheFresh(outletId: string): Promise<boolean> {
  const rows = await db
    .select({ scrapedAt: outletScrapeCache.scrapedAt })
    .from(outletScrapeCache)
    .where(eq(outletScrapeCache.outletId, outletId));

  if (rows.length === 0) return false;
  return Date.now() - new Date(rows[0].scrapedAt).getTime() < SCRAPE_CACHE_MAX_AGE_MS;
}

async function updateScrapeCache(outletId: string): Promise<void> {
  await db
    .insert(outletScrapeCache)
    .values({ outletId, scrapedAt: new Date() })
    .onConflictDoUpdate({
      target: outletScrapeCache.outletId,
      set: { scrapedAt: new Date() },
    });
}

/**
 * Reconstruct AuthorWithArticles from DB when scrape cache is fresh.
 * Uses journalists table + articleUrls from previous campaign_journalists entries.
 */
async function reconstructAuthorsFromDb(outletId: string): Promise<AuthorWithArticles[]> {
  const rows = await pgClient`
    SELECT DISTINCT ON (j.id)
      j.first_name AS "firstName",
      j.last_name AS "lastName",
      cj.article_urls AS "articleUrls"
    FROM journalists j
    INNER JOIN campaign_journalists cj ON j.id = cj.journalist_id
    WHERE j.outlet_id = ${outletId}
      AND j.entity_type = 'individual'
      AND j.first_name IS NOT NULL
      AND j.last_name IS NOT NULL
      AND cj.article_urls IS NOT NULL
    ORDER BY j.id, cj.created_at DESC
  `;

  const authorMap = new Map<string, AuthorWithArticles>();
  for (const row of rows) {
    const key = `${(row.firstName as string).toLowerCase()} ${(row.lastName as string).toLowerCase()}`;
    if (!authorMap.has(key)) {
      const urls = (row.articleUrls as string[]) || [];
      authorMap.set(key, {
        firstName: row.firstName as string,
        lastName: row.lastName as string,
        articles: urls.map((url) => ({ url, title: null, publishedAt: null })),
      });
    }
  }

  return Array.from(authorMap.values());
}

// ── Copy scores from previous campaigns ─────────────────────────────

/**
 * Copy campaign_journalists rows from previous campaigns to a new campaign.
 * Used when the scoring cache is fresh — avoids re-scraping and re-scoring.
 * Only copies journalists above the MIN_RELEVANCE_SCORE threshold.
 */
export async function copyScoresToCampaign(
  orgId: string,
  outletId: string,
  brandIds: string[],
  targetCampaignId: string,
  featureSlug: string | null,
  workflowSlug: string | null,
  runId: string | null,
): Promise<number> {
  // Get the best scores per journalist from any previous campaign for this org+outlet+brand
  const existing = await pgClient`
    SELECT DISTINCT ON (journalist_id)
      journalist_id AS "journalistId",
      relevance_score AS "relevanceScore",
      why_relevant AS "whyRelevant",
      why_not_relevant AS "whyNotRelevant",
      article_urls AS "articleUrls"
    FROM campaign_journalists
    WHERE org_id = ${orgId}
      AND outlet_id = ${outletId}
      AND brand_ids @> ${brandIds}::uuid[]
      AND campaign_id != ${targetCampaignId}
      AND relevance_score::numeric >= 30
    ORDER BY journalist_id, created_at DESC
  `;

  let copied = 0;
  for (const row of existing) {
    await db
      .insert(campaignJournalists)
      .values({
        journalistId: row.journalistId as string,
        orgId,
        brandIds,
        campaignId: targetCampaignId,
        outletId,
        relevanceScore: row.relevanceScore as string,
        whyRelevant: row.whyRelevant as string,
        whyNotRelevant: row.whyNotRelevant as string,
        articleUrls: (row.articleUrls as string[]) || [],
        featureSlug,
        workflowSlug,
        runId,
      })
      .onConflictDoNothing();
    copied++;
  }

  return copied;
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
  skipCache?: boolean;
}): Promise<number> {
  // Phase 1: Get authors — from scrape cache or fresh scrape
  let authors: AuthorWithArticles[];
  const scrapeFresh = !opts.skipCache && await isScrapeCacheFresh(opts.outletId);

  if (scrapeFresh) {
    console.log(
      `[journalists-service] Scrape cache hit for outletId=${opts.outletId} — using existing journalists`
    );
    authors = await reconstructAuthorsFromDb(opts.outletId);
  } else {
    const articlesResponse = await discoverOutletArticles(
      opts.outletDomain,
      opts.maxArticles,
      opts.ctx
    );
    authors = groupArticlesByAuthor(articlesResponse.articles);
    // Update scrape cache
    await updateScrapeCache(opts.outletId);
  }

  // Phase 2: Score authors via LLM — always pass existing journalists for matching
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
