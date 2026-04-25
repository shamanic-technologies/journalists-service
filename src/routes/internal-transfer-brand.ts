import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { campaignJournalists, discoveryCache } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

const TransferBrandBodySchema = z.object({
  sourceBrandId: z.string().uuid(),
  sourceOrgId: z.string().uuid(),
  targetOrgId: z.string().uuid(),
  targetBrandId: z.string().uuid().optional(),
});

router.post("/internal/transfer-brand", async (req, res) => {
  const parsed = TransferBrandBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sourceBrandId, sourceOrgId, targetOrgId, targetBrandId } = parsed.data;

  // Step 1: Move solo-brand rows from sourceOrg to targetOrg
  const cjRows = await db
    .update(campaignJournalists)
    .set({ orgId: targetOrgId })
    .where(
      and(
        eq(campaignJournalists.orgId, sourceOrgId),
        sql`${campaignJournalists.brandIds} = ARRAY[${sourceBrandId}]::uuid[]`
      )
    )
    .returning({ id: campaignJournalists.id });

  const dcRows = await db
    .update(discoveryCache)
    .set({ orgId: targetOrgId })
    .where(
      and(
        eq(discoveryCache.orgId, sourceOrgId),
        sql`${discoveryCache.brandIds} = ARRAY[${sourceBrandId}]::uuid[]`
      )
    )
    .returning({ id: discoveryCache.id });

  // Step 2: When targetBrandId is present, rewrite all remaining references
  // to sourceBrandId (no org filter — catches all orgs)
  if (targetBrandId) {
    await db
      .update(campaignJournalists)
      .set({ brandIds: [targetBrandId] })
      .where(sql`${campaignJournalists.brandIds} = ARRAY[${sourceBrandId}]::uuid[]`);

    await db
      .update(discoveryCache)
      .set({ brandIds: [targetBrandId] })
      .where(sql`${discoveryCache.brandIds} = ARRAY[${sourceBrandId}]::uuid[]`);
  }

  res.json({
    updatedTables: [
      { tableName: "campaign_journalists", count: cjRows.length },
      { tableName: "discovery_cache", count: dcRows.length },
    ],
  });
});

export default router;
