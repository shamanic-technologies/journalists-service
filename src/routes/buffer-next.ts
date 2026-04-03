import { Router } from "express";
import { db, sql as pgClient } from "../db/index.js";
import {
  campaignJournalists,
  journalists,
  discoveryCache,
  idempotencyCache,
} from "../db/schema.js";
import { eq, and, lt } from "drizzle-orm";
import { createChildRun } from "../lib/runs-client.js";
import {
  extractBrandFields,
  getFieldValue,
} from "../lib/brand-client.js";
import { fetchCampaign } from "../lib/campaign-client.js";
import { fetchOutlet, pullNextOutlet } from "../lib/outlets-client.js";
import { extractDomain, refillBuffer } from "../lib/journalist-discovery.js";
import {
  checkOutletBlocked,
  SERVED_COOLDOWN_MS,
  MIN_RELEVANCE_SCORE,
} from "../lib/outlet-blocked.js";
import { matchPerson } from "../lib/apollo-client.js";
import { checkEmailStatuses } from "../lib/email-gateway-client.js";
import { BufferNextSchema } from "../schemas.js";
import type { ServiceContext } from "../lib/service-context.js";

const router = Router();

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IDEMPOTENCY_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const APOLLO_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — don't re-call Apollo within this window
const MAX_PULL_ITERATIONS = 100;
const MAX_OUTLET_ITERATIONS = 20;
const CLEANUP_PROBABILITY = 0.01;

// Email statuses that indicate a usable email
const VALID_EMAIL_STATUSES = new Set(["verified", "guessed", "unavailable"]);

function getCtx(locals: Record<string, unknown>): ServiceContext {
  return {
    orgId: locals.orgId as string,
    userId: locals.userId as string,
    runId: locals.runId as string,
    featureSlug: locals.featureSlug as string,
    campaignId: locals.campaignId as string,
    brandIds: locals.brandIds as string[],
    workflowSlug: locals.workflowSlug as string,
  };
}

interface BufferNextResponse {
  found: boolean;
  reason?: string;
  runId?: string;
  journalist?: {
    id: string;
    journalistName: string;
    firstName: string;
    lastName: string;
    entityType: string;
    relevanceScore: number;
    whyRelevant: string;
    whyNotRelevant: string;
    articleUrls: string[];
    email?: string;
    apolloPersonId?: string;
    outletId?: string;
    outletName?: string;
    outletDomain?: string;
  };
}

/** Probabilistic cleanup of expired idempotency keys */
async function maybeCleanupIdempotencyCache(): Promise<void> {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  try {
    await db
      .delete(idempotencyCache)
      .where(lt(idempotencyCache.expiresAt, new Date()));
    console.log("[journalists-service] Idempotency cache cleanup ran");
  } catch {
    // Non-critical — ignore errors
  }
}

// ── Atomic claim via FOR UPDATE SKIP LOCKED ──────────────────────────

interface ClaimedRow {
  campaignJournalistId: string;
  journalistId: string;
  journalistName: string;
  firstName: string | null;
  lastName: string | null;
  entityType: string;
  relevanceScore: string;
  whyRelevant: string;
  whyNotRelevant: string;
  articleUrls: unknown;
}

async function claimNextBuffered(
  campaignId: string,
  outletId: string
): Promise<ClaimedRow | null> {
  const rows = await pgClient`
    UPDATE campaign_journalists
    SET status = 'claimed'
    WHERE id = (
      SELECT cj.id
      FROM campaign_journalists cj
      WHERE cj.campaign_id = ${campaignId}
        AND cj.outlet_id = ${outletId}
        AND cj.status = 'buffered'
        AND cj.relevance_score >= ${MIN_RELEVANCE_SCORE}
      ORDER BY cj.relevance_score DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id AS "campaignJournalistId",
      journalist_id AS "journalistId"
  `;

  if (rows.length === 0) return null;

  const row = rows[0];

  // Fetch journalist details
  const journalistRows = await db
    .select()
    .from(journalists)
    .where(eq(journalists.id, row.journalistId as string));

  if (journalistRows.length === 0) return null;

  const j = journalistRows[0];

  // Fetch campaign_journalist details for scores
  const cjRows = await db
    .select()
    .from(campaignJournalists)
    .where(eq(campaignJournalists.id, row.campaignJournalistId as string));

  if (cjRows.length === 0) return null;

  const cj = cjRows[0];

  return {
    campaignJournalistId: cj.id,
    journalistId: j.id,
    journalistName: j.journalistName,
    firstName: j.firstName,
    lastName: j.lastName,
    entityType: j.entityType,
    relevanceScore: cj.relevanceScore,
    whyRelevant: cj.whyRelevant,
    whyNotRelevant: cj.whyNotRelevant,
    articleUrls: cj.articleUrls,
  };
}

// ── Resolve email via Apollo + email-gateway dedup ──────────────────

interface ResolvedEmail {
  email: string;
  apolloPersonId: string | null;
}

/**
 * Check if a journalist has already been contacted for any of the given brands+org.
 *
 * "contacted" = status='contacted' OR (status IN ('claimed','served') AND created_at >= 1h ago).
 * The 1h window covers the race between serve and the downstream contacted callback.
 *
 * Three independent dedup axes — if ANY match, the journalist is blocked:
 * 1. By journalist_id (our internal ID — same person, same outlet)
 * 2. By email (same person across outlets)
 * 3. By apollo_person_id (same person, different emails)
 */
async function isAlreadyContacted(
  journalistId: string,
  email: string | null,
  apolloPersonId: string | null,
  orgId: string,
  brandIds: string[],
  excludeId: string // campaign_journalist row to exclude (the one we just claimed)
): Promise<{ contacted: boolean; reason: string }> {
  const servedCutoff = new Date(Date.now() - SERVED_COOLDOWN_MS).toISOString();

  // 1. By journalist_id
  const byJournalist = await pgClient`
    SELECT 1 FROM campaign_journalists
    WHERE journalist_id = ${journalistId}
      AND id != ${excludeId}
      AND org_id = ${orgId}
      AND brand_ids && ${brandIds}::uuid[]
      AND (
        status = 'contacted'
        OR (status IN ('claimed', 'served') AND created_at >= ${servedCutoff}::timestamptz)
      )
    LIMIT 1
  `;
  if (byJournalist.length > 0) {
    return { contacted: true, reason: `journalist ${journalistId} already contacted for this brand+org` };
  }

  // 2. By email
  if (email) {
    const byEmail = await pgClient`
      SELECT 1 FROM campaign_journalists
      WHERE email = ${email}
        AND id != ${excludeId}
        AND org_id = ${orgId}
        AND brand_ids && ${brandIds}::uuid[]
        AND (
          status = 'contacted'
          OR (status IN ('claimed', 'served') AND created_at >= ${servedCutoff}::timestamptz)
        )
      LIMIT 1
    `;
    if (byEmail.length > 0) {
      return { contacted: true, reason: `email ${email} already contacted for this brand+org` };
    }
  }

  // 3. By apollo_person_id
  if (apolloPersonId) {
    const byApollo = await pgClient`
      SELECT 1 FROM campaign_journalists
      WHERE apollo_person_id = ${apolloPersonId}
        AND id != ${excludeId}
        AND org_id = ${orgId}
        AND brand_ids && ${brandIds}::uuid[]
        AND (
          status = 'contacted'
          OR (status IN ('claimed', 'served') AND created_at >= ${servedCutoff}::timestamptz)
        )
      LIMIT 1
    `;
    if (byApollo.length > 0) {
      return { contacted: true, reason: `apollo person ${apolloPersonId} already contacted for this brand+org` };
    }
  }

  return { contacted: false, reason: "" };
}

/**
 * Try to resolve a verified, non-contacted email for a claimed journalist.
 * Returns null if Apollo has no match, email is bad, or already contacted for brand+org.
 */
async function resolveAndCheckEmail(
  claimed: ClaimedRow,
  outletDomain: string,
  orgId: string,
  brandIds: string[],
  ctx: ServiceContext
): Promise<ResolvedEmail | null> {
  const firstName = claimed.firstName || "";
  const lastName = claimed.lastName || "";

  // Pre-check: journalist_id dedup (before Apollo call to save API credits)
  const preCheck = await isAlreadyContacted(
    claimed.journalistId, null, null, orgId, brandIds, claimed.campaignJournalistId
  );
  if (preCheck.contacted) {
    console.log(`[journalists-service] ${preCheck.reason}`);
    return null;
  }

  if (!firstName || !lastName) {
    console.log(
      `[journalists-service] Skipping Apollo match — missing name for journalist ${claimed.journalistId}`
    );
    return null;
  }

  // Check global journalists table for cached Apollo results
  const cachedRows = await db
    .select({
      apolloEmail: journalists.apolloEmail,
      apolloEmailStatus: journalists.apolloEmailStatus,
      apolloPersonId: journalists.apolloPersonId,
      apolloCheckedAt: journalists.apolloCheckedAt,
    })
    .from(journalists)
    .where(eq(journalists.id, claimed.journalistId));

  const cached = cachedRows[0];
  const isCacheFresh =
    cached?.apolloCheckedAt &&
    Date.now() - new Date(cached.apolloCheckedAt).getTime() < APOLLO_CACHE_MAX_AGE_MS;

  let email: string | null = null;
  let emailStatus: string | null = null;
  let apolloPersonId: string | null = null;

  if (isCacheFresh) {
    // Cache hit — use stored results
    if (!cached.apolloEmail) {
      console.log(
        `[journalists-service] Apollo cache: no email for ${firstName} ${lastName} (checked ${cached.apolloCheckedAt!.toISOString()})`
      );
      return null;
    }
    email = cached.apolloEmail;
    emailStatus = cached.apolloEmailStatus;
    apolloPersonId = cached.apolloPersonId;
    console.log(
      `[journalists-service] Apollo cache hit: ${email} for ${firstName} ${lastName}`
    );
  } else {
    // Cache miss or stale — call Apollo
    const apolloResult = await matchPerson(firstName, lastName, outletDomain, ctx);

    // Store results on global journalists table (even if no email)
    await db
      .update(journalists)
      .set({
        apolloEmail: apolloResult.person?.email ?? null,
        apolloEmailStatus: apolloResult.person?.emailStatus ?? null,
        apolloPersonId: apolloResult.person?.id ?? null,
        apolloCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(journalists.id, claimed.journalistId));

    if (!apolloResult.person?.email) {
      console.log(
        `[journalists-service] Apollo: no email for ${firstName} ${lastName} @ ${outletDomain}`
      );
      return null;
    }

    email = apolloResult.person.email;
    emailStatus = apolloResult.person.emailStatus ?? null;
    apolloPersonId = apolloResult.person.id ?? null;
  }

  // Check email quality — reject "bounced" or unknown statuses
  if (emailStatus && !VALID_EMAIL_STATUSES.has(emailStatus)) {
    console.log(
      `[journalists-service] Apollo: bad emailStatus "${emailStatus}" for ${email}`
    );
    return null;
  }

  // Full dedup: email + apollo_person_id (journalist_id already checked above)
  const fullCheck = await isAlreadyContacted(
    claimed.journalistId, email, apolloPersonId, orgId, brandIds, claimed.campaignJournalistId
  );
  if (fullCheck.contacted) {
    console.log(`[journalists-service] ${fullCheck.reason}`);
    return null;
  }

  // Email-gateway: check global bounced/unsubscribed
  const gatewayResults = await checkEmailStatuses(
    [{ leadId: claimed.journalistId, email }],
    undefined,
    ctx
  );

  if (gatewayResults.length > 0) {
    const result = gatewayResults[0];
    if (result.broadcast?.global?.email?.bounced) {
      console.log(
        `[journalists-service] Email ${email} globally bounced`
      );
      return null;
    }
    if (result.broadcast?.global?.email?.unsubscribed) {
      console.log(
        `[journalists-service] Email ${email} globally unsubscribed`
      );
      return null;
    }
  }

  return {
    email,
    apolloPersonId,
  };
}

// ── Process a single outlet: claim journalist + resolve email ────────

interface OutletContext {
  outletId: string;
  outletName: string;
  outletUrl: string;
  outletDomain: string;
}

/**
 * Try to find a journalist with a verified email at the given outlet.
 * Loops through buffered journalists, refilling once if needed.
 * Returns the journalist + email, or null if outlet is exhausted.
 */
async function processOutlet(
  outlet: OutletContext,
  campaignId: string,
  brandIds: string[],
  maxArticles: number,
  ctx: ServiceContext
): Promise<BufferNextResponse> {
  // ── Relevance gate ─────────────────────────────────────────
  const blocked = await checkOutletBlocked(outlet.outletId, campaignId, ctx.orgId, brandIds);
  if (blocked.blocked) {
    await pgClient`
      UPDATE campaign_journalists
      SET status = 'skipped'
      WHERE campaign_id = ${campaignId}
        AND outlet_id = ${outlet.outletId}
        AND status = 'buffered'
        AND relevance_score < ${MIN_RELEVANCE_SCORE}
    `;
    console.log(
      `[journalists-service] Outlet blocked: ${blocked.reason} (outletId=${outlet.outletId} campaignId=${campaignId})`
    );
    return { found: false, reason: blocked.reason };
  }

  const childRun = await createChildRun(
    {
      parentRunId: ctx.runId,
      serviceName: "journalists-service",
      taskName: "buffer-next",
    },
    ctx
  );
  const childCtx: ServiceContext = { ...ctx, runId: childRun.id };

  let hasAttemptedRefill = false;

  for (let i = 0; i < MAX_PULL_ITERATIONS; i++) {
    const claimed = await claimNextBuffered(campaignId, outlet.outletId);

    if (claimed) {
      // Try to resolve email + dedup by email/apolloPersonId/journalistId at brand+org level
      const resolved = await resolveAndCheckEmail(
        claimed,
        outlet.outletDomain,
        ctx.orgId,
        brandIds,
        childCtx
      );

      if (resolved) {
        // Email found and valid — mark as served with email data
        await db
          .update(campaignJournalists)
          .set({
            status: "served",
            email: resolved.email,
            apolloPersonId: resolved.apolloPersonId,
          })
          .where(eq(campaignJournalists.id, claimed.campaignJournalistId));

        return {
          found: true,
          runId: childRun.id,
          journalist: {
            id: claimed.journalistId,
            journalistName: claimed.journalistName,
            firstName: claimed.firstName || "",
            lastName: claimed.lastName || "",
            entityType: claimed.entityType,
            relevanceScore: Number(claimed.relevanceScore),
            whyRelevant: claimed.whyRelevant,
            whyNotRelevant: claimed.whyNotRelevant,
            articleUrls: (claimed.articleUrls as string[]) || [],
            email: resolved.email,
            apolloPersonId: resolved.apolloPersonId ?? undefined,
            outletId: outlet.outletId,
            outletName: outlet.outletName,
            outletDomain: outlet.outletDomain,
          },
        };
      }

      // No email — mark as skipped, try next journalist
      await db
        .update(campaignJournalists)
        .set({ status: "skipped" })
        .where(eq(campaignJournalists.id, claimed.campaignJournalistId));

      console.log(
        `[journalists-service] Skipped journalist ${claimed.firstName} ${claimed.lastName} — no valid email`
      );
      continue;
    }

    // Buffer empty — try refill (only once)
    if (hasAttemptedRefill) {
      return { found: false, runId: childRun.id };
    }

    hasAttemptedRefill = true;

    // Check discovery cache
    const discoveryCached = await db
      .select()
      .from(discoveryCache)
      .where(
        and(
          eq(discoveryCache.orgId, ctx.orgId),
          eq(discoveryCache.campaignId, campaignId),
          eq(discoveryCache.outletId, outlet.outletId)
        )
      );

    const isFresh =
      discoveryCached.length > 0 &&
      Date.now() - new Date(discoveryCached[0].discoveredAt).getTime() <
        CACHE_MAX_AGE_MS;

    if (isFresh) {
      return { found: false, runId: childRun.id };
    }

    // Refill buffer
    const [brandFields, campaign] = await Promise.all([
      extractBrandFields(
        [
          { key: "brand_name", description: "The brand's name" },
          {
            key: "brand_description",
            description:
              "A concise description of what the brand does, its products, and market positioning",
          },
        ],
        childCtx
      ),
      fetchCampaign(campaignId, childCtx),
    ]);

    const brandName =
      getFieldValue(brandFields.fields, "brand_name") || "Unknown Brand";
    const brandDescription = getFieldValue(
      brandFields.fields,
      "brand_description"
    );

    const featureInputs = campaign.featureInputs ?? {};

    const filled = await refillBuffer({
      outletDomain: outlet.outletDomain,
      outletId: outlet.outletId,
      campaignId,
      brandName,
      brandDescription,
      featureInputs,
      maxArticles,
      orgId: ctx.orgId,
      brandIds,
      ctx: childCtx,
      runId: childRun.id,
    });

    // Update discovery cache
    await db
      .insert(discoveryCache)
      .values({
        orgId: ctx.orgId,
        brandIds,
        campaignId,
        outletId: outlet.outletId,
        discoveredAt: new Date(),
        runId: childRun.id,
      })
      .onConflictDoUpdate({
        target: [
          discoveryCache.orgId,
          discoveryCache.campaignId,
          discoveryCache.outletId,
        ],
        set: {
          brandIds,
          discoveredAt: new Date(),
          runId: childRun.id,
        },
      });

    if (filled === 0) {
      return { found: false, runId: childRun.id };
    }

    // Loop back to claim from the freshly-filled buffer
  }

  return { found: false };
}

// ── Route handler ───────────────────────────────────────────────────

router.post("/buffer/next", async (req, res) => {
  const parsed = BufferNextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { outletId, maxArticles, idempotencyKey } = parsed.data;
  const ctx = getCtx(res.locals);
  const campaignId = ctx.campaignId;
  const brandIds = ctx.brandIds;

  console.log(
    `[journalists-service] POST /buffer/next — outletId=${outletId ?? "(auto)"} campaignId=${campaignId} brandIds=${brandIds.join(",")} orgId=${ctx.orgId}`
  );

  try {
    // Probabilistic cleanup
    maybeCleanupIdempotencyCache();

    // Check idempotency cache
    if (idempotencyKey) {
      const cached = await db
        .select()
        .from(idempotencyCache)
        .where(eq(idempotencyCache.idempotencyKey, idempotencyKey));

      if (cached.length > 0 && new Date(cached[0].expiresAt) > new Date()) {
        res.json(cached[0].responseBody);
        return;
      }
    }

    let response: BufferNextResponse;

    if (outletId) {
      // ── Explicit outlet — single attempt ──────────────────────
      const outlet = await fetchOutlet(outletId, ctx);
      const outletDomain = extractDomain(outlet.outletUrl);

      response = await processOutlet(
        {
          outletId,
          outletName: outlet.outletName || outletDomain,
          outletUrl: outlet.outletUrl,
          outletDomain,
        },
        campaignId,
        brandIds,
        maxArticles,
        ctx
      );
    } else {
      // ── No outlet — pull from outlets-service, loop until found ─
      response = { found: false };

      for (let i = 0; i < MAX_OUTLET_ITERATIONS; i++) {
        const pulled = await pullNextOutlet(ctx);

        if (!pulled) {
          console.log(
            `[journalists-service] No more outlets available from outlets-service`
          );
          response = { found: false, reason: "no outlets available" };
          break;
        }

        console.log(
          `[journalists-service] Trying outlet: ${pulled.outletName} (${pulled.outletDomain})`
        );

        const result = await processOutlet(
          {
            outletId: pulled.outletId,
            outletName: pulled.outletName,
            outletUrl: pulled.outletUrl,
            outletDomain: pulled.outletDomain,
          },
          campaignId,
          brandIds,
          maxArticles,
          ctx
        );

        if (result.found) {
          response = result;
          break;
        }

        console.log(
          `[journalists-service] Outlet ${pulled.outletName} exhausted: ${result.reason ?? "no journalists with email"}`
        );
        // Continue to next outlet
      }
    }

    const journalistLabel = response.found
      ? ` journalist="${response.journalist!.firstName} ${response.journalist!.lastName}" email=${response.journalist!.email ?? "none"}`
      : "";
    console.log(
      `[journalists-service] POST /buffer/next result — found=${response.found}${journalistLabel}`
    );

    // Save to idempotency cache
    if (idempotencyKey) {
      await db
        .insert(idempotencyCache)
        .values({
          idempotencyKey,
          responseBody: response,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        })
        .onConflictDoUpdate({
          target: idempotencyCache.idempotencyKey,
          set: {
            responseBody: response,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
    }

    res.json(response);
  } catch (err) {
    console.error("[journalists-service] Buffer/next error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: message });
  }
});

export default router;
