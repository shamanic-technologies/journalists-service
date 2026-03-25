import { Router } from "express";
import { db, sql } from "../db/index.js";
import { campaignOutletJournalists } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { createChildRun } from "../lib/runs-client.js";
import { fetchBrand } from "../lib/brand-client.js";
import { fetchOutlet } from "../lib/outlets-client.js";
import {
  extractDomain,
  discoverAndScoreJournalists,
} from "../lib/journalist-discovery.js";
import { ResolveJournalistsSchema } from "../schemas.js";

const router = Router();

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

router.post("/journalists/resolve", async (req, res) => {
  const parsed = ResolveJournalistsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, featureInputs, maxArticles } = parsed.data;

  const orgId = res.locals.orgId as string;
  const userId = res.locals.userId as string;
  const runId = res.locals.runId as string;
  const featureSlug = res.locals.featureSlug as string | null;
  const campaignId = res.locals.campaignId as string | null;
  const brandId = res.locals.brandId as string | null;

  if (!campaignId) {
    res.status(400).json({ error: "x-campaign-id header is required" });
    return;
  }
  if (!brandId) {
    res.status(400).json({ error: "x-brand-id header is required" });
    return;
  }

  try {
    // Check cache: do we have scores for this campaign+outlet?
    const existingScores = await db
      .select()
      .from(campaignOutletJournalists)
      .where(
        and(
          eq(campaignOutletJournalists.campaignId, campaignId),
          eq(campaignOutletJournalists.outletId, outletId)
        )
      );

    const isFresh =
      existingScores.length > 0 &&
      existingScores.every(
        (s) =>
          Date.now() - new Date(s.createdAt).getTime() < CACHE_MAX_AGE_MS
      );

    if (isFresh) {
      // Fast path: return cached scores with journalist info + emails
      const result = await fetchJournalistsWithEmails(
        outletId,
        campaignId,
        existingScores
      );
      res.json({ journalists: result, cached: true });
      return;
    }

    // Slow path: discover + score
    const { run: childRun } = await createChildRun(
      {
        parentRunId: runId,
        service: "journalists-service",
        operation: "resolve-journalists",
      },
      orgId,
      userId,
      featureSlug
    );
    const childRunId = childRun.id;

    const [brand, outlet] = await Promise.all([
      fetchBrand(brandId, orgId, userId, childRunId, featureSlug),
      fetchOutlet(outletId, orgId, userId, childRunId, featureSlug),
    ]);

    const brandName = brand.name || "Unknown Brand";
    const brandDescription = [brand.elevatorPitch, brand.bio, brand.mission]
      .filter(Boolean)
      .join(". ");
    const outletDomain = extractDomain(outlet.outletUrl);

    await discoverAndScoreJournalists({
      outletDomain,
      outletId,
      campaignId,
      brandName,
      brandDescription,
      featureInputs,
      maxArticles,
      orgId,
      userId,
      runId: childRunId,
      featureSlug,
    });

    // Re-fetch from DB to get the full picture with emails
    const freshScores = await db
      .select()
      .from(campaignOutletJournalists)
      .where(
        and(
          eq(campaignOutletJournalists.campaignId, campaignId),
          eq(campaignOutletJournalists.outletId, outletId)
        )
      );

    const result = await fetchJournalistsWithEmails(
      outletId,
      campaignId,
      freshScores
    );
    res.json({ journalists: result, cached: false });
  } catch (err) {
    console.error("Resolve journalists error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

// ── Fetch journalists with scores + emails ───────────────────────────

interface ResolvedJournalist {
  id: string;
  journalistName: string;
  firstName: string;
  lastName: string;
  entityType: string;
  relevanceScore: number;
  whyRelevant: string;
  whyNotRelevant: string;
  emails: Array<{ email: string; isValid: boolean; confidence: number }>;
}

async function fetchJournalistsWithEmails(
  outletId: string,
  campaignId: string,
  scores: Array<{
    journalistId: string;
    relevanceScore: string;
    whyRelevant: string;
    whyNotRelevant: string;
  }>
): Promise<ResolvedJournalist[]> {
  if (scores.length === 0) return [];

  const journalistIds = scores.map((s) => s.journalistId);

  // Fetch journalist details
  const journalists = await sql.unsafe(
    `SELECT id, journalist_name, first_name, last_name, entity_type
     FROM press_journalists
     WHERE id = ANY($1)`,
    [journalistIds]
  );

  // Fetch emails
  const emails = await sql.unsafe(
    `SELECT journalist_id, email, is_valid, confidence
     FROM v_valid_journalist_emails
     WHERE outlet_id = $1 AND journalist_id = ANY($2)`,
    [outletId, journalistIds]
  );

  // Build email map
  const emailsByJournalist = new Map<
    string,
    Array<{ email: string; isValid: boolean; confidence: number }>
  >();
  for (const e of emails) {
    const jId = e.journalist_id as string;
    if (!emailsByJournalist.has(jId)) {
      emailsByJournalist.set(jId, []);
    }
    emailsByJournalist.get(jId)!.push({
      email: e.email as string,
      isValid: e.is_valid as boolean,
      confidence: Number(e.confidence),
    });
  }

  // Build score map
  const scoreMap = new Map(
    scores.map((s) => [
      s.journalistId,
      {
        relevanceScore: Number(s.relevanceScore),
        whyRelevant: s.whyRelevant,
        whyNotRelevant: s.whyNotRelevant,
      },
    ])
  );

  // Assemble + sort by relevance DESC
  const result: ResolvedJournalist[] = journalists
    .map((j) => {
      const score = scoreMap.get(j.id as string);
      const journalistEmails = emailsByJournalist.get(j.id as string) || [];
      // Sort emails by confidence DESC
      journalistEmails.sort((a, b) => b.confidence - a.confidence);

      return {
        id: j.id as string,
        journalistName: j.journalist_name as string,
        firstName: (j.first_name as string) || "",
        lastName: (j.last_name as string) || "",
        entityType: j.entity_type as string,
        relevanceScore: score?.relevanceScore ?? 0,
        whyRelevant: score?.whyRelevant ?? "",
        whyNotRelevant: score?.whyNotRelevant ?? "",
        emails: journalistEmails,
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  return result;
}

export default router;
