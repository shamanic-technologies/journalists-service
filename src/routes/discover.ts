import { Router } from "express";
import { db } from "../db/index.js";
import {
  pressJournalists,
  outletJournalists,
  enrichedIndividuals,
  enrichedEmails,
} from "../db/schema.js";
import { eq, inArray, and } from "drizzle-orm";
import {
  apolloMatchBulk,
  type ApolloPerson,
  type ApolloMatchResult,
} from "../lib/apollo-client.js";
import { DiscoverEmailsSchema } from "../schemas.js";

const router = Router();

const APOLLO_BATCH_SIZE = 10;

function mapEmailStatus(
  apolloStatus: string | null
): "valid" | "invalid" | "risky" | "unknown" {
  switch (apolloStatus) {
    case "verified":
      return "valid";
    case "invalid":
      return "invalid";
    case "guessed":
    case "unavailable":
    default:
      return "unknown";
  }
}

function mapVerificationStatus(
  apolloStatus: string | null
): "valid" | "accept_all" | "unknown" | "invalid" {
  switch (apolloStatus) {
    case "verified":
      return "valid";
    case "invalid":
      return "invalid";
    default:
      return "unknown";
  }
}

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
    runId,
    appId,
    brandId,
    campaignId,
    clerkOrgId,
  } = parsed.data;

  // Fetch journalists to discover emails for
  let journalists: Array<{
    journalistId: string;
    firstName: string | null;
    lastName: string | null;
  }>;

  if (journalistIds && journalistIds.length > 0) {
    // Specific journalist IDs provided
    const rows = await db
      .select({
        journalistId: outletJournalists.journalistId,
        firstName: pressJournalists.firstName,
        lastName: pressJournalists.lastName,
      })
      .from(outletJournalists)
      .innerJoin(
        pressJournalists,
        eq(outletJournalists.journalistId, pressJournalists.id)
      )
      .where(
        and(
          eq(outletJournalists.outletId, outletId),
          inArray(outletJournalists.journalistId, journalistIds)
        )
      );
    journalists = rows;
  } else {
    // All journalists for the outlet
    const rows = await db
      .select({
        journalistId: outletJournalists.journalistId,
        firstName: pressJournalists.firstName,
        lastName: pressJournalists.lastName,
      })
      .from(outletJournalists)
      .innerJoin(
        pressJournalists,
        eq(outletJournalists.journalistId, pressJournalists.id)
      )
      .where(eq(outletJournalists.outletId, outletId));
    journalists = rows;
  }

  // Filter to journalists with firstName + lastName
  const matchable = journalists.filter((j) => j.firstName && j.lastName);

  if (matchable.length === 0) {
    res.json({
      discovered: 0,
      total: journalists.length,
      skipped: journalists.length,
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
        runId,
        appId,
        brandId,
        campaignId,
      },
      clerkOrgId
    );

    // Map results back to journalist IDs
    for (let k = 0; k < batch.length; k++) {
      const result: ApolloMatchResult | undefined =
        apolloResponse.results[k];
      if (result) {
        allResults.push({
          journalistId: batch[k].journalistId,
          ...result,
        });
      }
    }
  }

  // Store results in enriched_individuals + enriched_emails
  const now = new Date();
  let discovered = 0;

  for (const result of allResults) {
    const journalist = matchable.find(
      (j) => j.journalistId === result.journalistId
    )!;

    // Always store enriched_individuals record (even if no email found)
    await db
      .insert(enrichedIndividuals)
      .values({
        firstName: journalist.firstName!,
        lastName: journalist.lastName!,
        domain: organizationDomain,
        enrichedAt: now,
        position: result.person?.title || null,
        linkedinUrl: result.person?.linkedinUrl || null,
        company: result.person?.organizationName || null,
        verificationStatus: mapVerificationStatus(
          result.person?.emailStatus || null
        ),
        sources: [{ type: "apollo", enrichmentId: result.enrichmentId }],
      })
      .onConflictDoNothing();

    // Store email if found
    if (result.person?.email) {
      discovered++;

      await db
        .insert(enrichedEmails)
        .values({
          email: result.person.email,
          enrichedAt: now,
          status: mapEmailStatus(result.person.emailStatus),
          sources: [{ type: "apollo", enrichmentId: result.enrichmentId }],
        })
        .onConflictDoNothing();
    }
  }

  res.json({
    discovered,
    total: matchable.length,
    skipped: journalists.length - matchable.length,
    results: allResults.map((r) => ({
      journalistId: r.journalistId,
      email: r.person?.email || null,
      emailStatus: r.person?.emailStatus || null,
      cached: r.cached,
      enrichmentId: r.enrichmentId,
    })),
  });
});

export default router;
