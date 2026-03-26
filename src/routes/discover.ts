import { Router } from "express";
import { db } from "../db/index.js";
import { journalists } from "../db/schema.js";
import { eq, inArray, and } from "drizzle-orm";
import {
  apolloMatchBulk,
  type ApolloPerson,
  type ApolloMatchResult,
} from "../lib/apollo-client.js";
import { createChildRun } from "../lib/runs-client.js";
import { DiscoverEmailsSchema } from "../schemas.js";

const router = Router();

const APOLLO_BATCH_SIZE = 10;

// POST /journalists/discover-emails
router.post("/journalists/discover-emails", async (req, res) => {
  const parsed = DiscoverEmailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    outletId,
    organizationDomain,
    journalistIds,
    brandId,
    campaignId,
  } = parsed.data;

  const orgId = res.locals.orgId as string;
  const userId = res.locals.userId as string;
  const runId = res.locals.runId as string;
  const featureSlug = res.locals.featureSlug as string | null;

  try {
  // Create a child run in runs-service (parentRunId = caller's runId from header)
  const { run: childRun } = await createChildRun(
    {
      parentRunId: runId,
      service: "journalists-service",
      operation: "discover-emails",
    },
    orgId,
    userId,
    featureSlug
  );
  const childRunId = childRun.id;

  // Fetch journalists to discover emails for
  let journalistRows: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
  }>;

  if (journalistIds && journalistIds.length > 0) {
    journalistRows = await db
      .select({
        id: journalists.id,
        firstName: journalists.firstName,
        lastName: journalists.lastName,
      })
      .from(journalists)
      .where(
        and(
          eq(journalists.outletId, outletId),
          inArray(journalists.id, journalistIds)
        )
      );
  } else {
    journalistRows = await db
      .select({
        id: journalists.id,
        firstName: journalists.firstName,
        lastName: journalists.lastName,
      })
      .from(journalists)
      .where(eq(journalists.outletId, outletId));
  }

  // Filter to journalists with firstName + lastName
  const matchable = journalistRows.filter((j) => j.firstName && j.lastName);

  if (matchable.length === 0) {
    res.json({
      discovered: 0,
      total: journalistRows.length,
      skipped: journalistRows.length,
      results: [],
    });
    return;
  }

  // Process in batches of 10 (Apollo limit)
  const allResults: Array<{
    journalistId: string;
    person: ApolloPerson | null;
    enrichmentId: string;
    cached: boolean;
  }> = [];

  for (let i = 0; i < matchable.length; i += APOLLO_BATCH_SIZE) {
    const batch = matchable.slice(i, i + APOLLO_BATCH_SIZE);

    const apolloResponse = await apolloMatchBulk(
      {
        items: batch.map((j) => ({
          firstName: j.firstName!,
          lastName: j.lastName!,
          organizationDomain,
        })),
        runId: childRunId,
        brandId,
        campaignId,
      },
      orgId,
      userId,
      childRunId,
      featureSlug
    );

    // Map results back to journalist IDs
    for (let k = 0; k < batch.length; k++) {
      const result: ApolloMatchResult | undefined =
        apolloResponse.results[k];
      if (result) {
        allResults.push({
          journalistId: batch[k].id,
          ...result,
        });
      }
    }
  }

  let discovered = 0;
  for (const result of allResults) {
    if (result.person?.email) {
      discovered++;
    }
  }

  res.json({
    discovered,
    total: matchable.length,
    skipped: journalistRows.length - matchable.length,
    results: allResults.map((r) => ({
      journalistId: r.journalistId,
      email: r.person?.email || null,
      emailStatus: r.person?.emailStatus || null,
      cached: r.cached,
      enrichmentId: r.enrichmentId,
    })),
  });
  } catch (err) {
    console.error("Discover emails error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

export default router;
