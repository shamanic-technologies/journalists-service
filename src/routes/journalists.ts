import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  pressJournalists,
  outletJournalists,
  campaignOutletJournalists,
} from "../db/schema.js";
import {
  CreateJournalistSchema,
  UpdateJournalistSchema,
  JournalistListQuerySchema,
} from "../schemas.js";

const router = Router();

// POST /journalists
router.post("/journalists", async (req, res) => {
  const parsed = CreateJournalistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [journalist] = await db
      .insert(pressJournalists)
      .values(parsed.data)
      .returning();
    res.status(201).json({ journalist });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "Journalist with this name and entity type already exists" });
      return;
    }
    throw err;
  }
});

// GET /journalists
router.get("/journalists", async (req, res) => {
  const parsed = JournalistListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { entity_type, outlet_id, campaign_id } = parsed.data;

  let journalists;

  if (outlet_id) {
    // Join with outlet_journalists
    const rows = await db
      .select({
        id: pressJournalists.id,
        entityType: pressJournalists.entityType,
        journalistName: pressJournalists.journalistName,
        firstName: pressJournalists.firstName,
        lastName: pressJournalists.lastName,
        createdAt: pressJournalists.createdAt,
        updatedAt: pressJournalists.updatedAt,
      })
      .from(pressJournalists)
      .innerJoin(
        outletJournalists,
        eq(pressJournalists.id, outletJournalists.journalistId)
      )
      .where(
        and(
          eq(outletJournalists.outletId, outlet_id),
          entity_type
            ? eq(pressJournalists.entityType, entity_type)
            : undefined
        )
      );
    journalists = rows;
  } else if (campaign_id) {
    // Join with campaign_outlet_journalists
    const rows = await db
      .select({
        id: pressJournalists.id,
        entityType: pressJournalists.entityType,
        journalistName: pressJournalists.journalistName,
        firstName: pressJournalists.firstName,
        lastName: pressJournalists.lastName,
        createdAt: pressJournalists.createdAt,
        updatedAt: pressJournalists.updatedAt,
      })
      .from(pressJournalists)
      .innerJoin(
        campaignOutletJournalists,
        eq(pressJournalists.id, campaignOutletJournalists.journalistId)
      )
      .where(
        and(
          eq(campaignOutletJournalists.campaignId, campaign_id),
          entity_type
            ? eq(pressJournalists.entityType, entity_type)
            : undefined
        )
      );
    journalists = rows;
  } else {
    // Simple query
    const conditions = [];
    if (entity_type) {
      conditions.push(eq(pressJournalists.entityType, entity_type));
    }
    journalists = await db
      .select()
      .from(pressJournalists)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  res.json({ journalists });
});

// GET /journalists/:id
router.get("/journalists/:id", async (req, res) => {
  const { id } = req.params;

  const [journalist] = await db
    .select()
    .from(pressJournalists)
    .where(eq(pressJournalists.id, id));

  if (!journalist) {
    res.status(404).json({ error: "Journalist not found" });
    return;
  }

  res.json({ journalist });
});

// PATCH /journalists/:id
router.patch("/journalists/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = UpdateJournalistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData = {
    ...parsed.data,
    updatedAt: new Date(),
  };

  const [journalist] = await db
    .update(pressJournalists)
    .set(updateData)
    .where(eq(pressJournalists.id, id))
    .returning();

  if (!journalist) {
    res.status(404).json({ error: "Journalist not found" });
    return;
  }

  res.json({ journalist });
});

export default router;
