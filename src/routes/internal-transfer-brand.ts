import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { campaignJournalists, discoveryCache } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

const TransferBrandBodySchema = z.object({
  brandId: z.string().uuid(),
  sourceOrgId: z.string().uuid(),
  targetOrgId: z.string().uuid(),
});

router.post("/internal/transfer-brand", async (req, res) => {
  const parsed = TransferBrandBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { brandId, sourceOrgId, targetOrgId } = parsed.data;

  const cjRows = await db
    .update(campaignJournalists)
    .set({ orgId: targetOrgId })
    .where(
      and(
        eq(campaignJournalists.orgId, sourceOrgId),
        sql`${campaignJournalists.brandIds} = ARRAY[${brandId}]::uuid[]`
      )
    )
    .returning({ id: campaignJournalists.id });

  const dcRows = await db
    .update(discoveryCache)
    .set({ orgId: targetOrgId })
    .where(
      and(
        eq(discoveryCache.orgId, sourceOrgId),
        sql`${discoveryCache.brandIds} = ARRAY[${brandId}]::uuid[]`
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
