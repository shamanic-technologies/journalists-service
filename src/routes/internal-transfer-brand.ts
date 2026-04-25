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

  const cjSet: { orgId: string; brandIds?: string[] } = { orgId: targetOrgId };
  if (targetBrandId) {
    cjSet.brandIds = [targetBrandId];
  }

  const cjRows = await db
    .update(campaignJournalists)
    .set(cjSet)
    .where(
      and(
        eq(campaignJournalists.orgId, sourceOrgId),
        sql`${campaignJournalists.brandIds} = ARRAY[${sourceBrandId}]::uuid[]`
      )
    )
    .returning({ id: campaignJournalists.id });

  const dcSet: { orgId: string; brandIds?: string[] } = { orgId: targetOrgId };
  if (targetBrandId) {
    dcSet.brandIds = [targetBrandId];
  }

  const dcRows = await db
    .update(discoveryCache)
    .set(dcSet)
    .where(
      and(
        eq(discoveryCache.orgId, sourceOrgId),
        sql`${discoveryCache.brandIds} = ARRAY[${sourceBrandId}]::uuid[]`
      )
    )
    .returning({ id: discoveryCache.id });

  res.json({
    updatedTables: [
      { tableName: "campaign_journalists", count: cjRows.length },
      { tableName: "discovery_cache", count: dcRows.length },
    ],
  });
});

export default router;
