import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { outletJournalists, pressJournalists } from "../db/schema.js";
import { CreateOutletJournalistSchema } from "../schemas.js";

const router = Router();

// POST /outlet-journalists
router.post("/outlet-journalists", async (req, res) => {
  const parsed = CreateOutletJournalistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .insert(outletJournalists)
    .values(parsed.data)
    .onConflictDoNothing();

  res.status(201).json({ outletJournalist: parsed.data });
});

// GET /outlet-journalists
router.get("/outlet-journalists", async (req, res) => {
  const { outlet_id, journalist_id } = req.query as {
    outlet_id?: string;
    journalist_id?: string;
  };

  const conditions = [];
  if (outlet_id) {
    conditions.push(eq(outletJournalists.outletId, outlet_id));
  }
  if (journalist_id) {
    conditions.push(eq(outletJournalists.journalistId, journalist_id));
  }

  const rows = await db
    .select({
      outletId: outletJournalists.outletId,
      journalistId: outletJournalists.journalistId,
      journalistName: pressJournalists.journalistName,
      firstName: pressJournalists.firstName,
      lastName: pressJournalists.lastName,
      entityType: pressJournalists.entityType,
    })
    .from(outletJournalists)
    .innerJoin(
      pressJournalists,
      eq(outletJournalists.journalistId, pressJournalists.id)
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({ outletJournalists: rows });
});

// DELETE /outlet-journalists/:outletId/:journalistId
router.delete(
  "/outlet-journalists/:outletId/:journalistId",
  async (req, res) => {
    const { outletId, journalistId } = req.params;

    const result = await db
      .delete(outletJournalists)
      .where(
        and(
          eq(outletJournalists.outletId, outletId),
          eq(outletJournalists.journalistId, journalistId)
        )
      )
      .returning();

    if (result.length === 0) {
      res.status(404).json({ error: "Outlet-journalist link not found" });
      return;
    }

    res.json({ deleted: true });
  }
);

export default router;
