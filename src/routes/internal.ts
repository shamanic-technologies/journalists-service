import { Router } from "express";
import { inArray, eq } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { pressJournalists } from "../db/schema.js";

const router = Router();

// GET /internal/journalists/by-outlet-with-emails/:outletId
router.get(
  "/internal/journalists/by-outlet-with-emails/:outletId",
  async (req, res) => {
    const { outletId } = req.params;

    // Get journalists linked to this outlet
    const journalists = await sql.unsafe(
      `SELECT
        pj.id,
        pj.journalist_name,
        pj.first_name,
        pj.last_name,
        pj.entity_type
      FROM press_journalists pj
      INNER JOIN outlet_journalists oj ON oj.journalist_id = pj.id
      WHERE oj.outlet_id = $1`,
      [outletId]
    );

    // Get valid emails for this outlet
    const emails = await sql.unsafe(
      `SELECT journalist_id, email, is_valid, confidence
       FROM v_valid_journalist_emails
       WHERE outlet_id = $1`,
      [outletId]
    );

    // Group emails by journalist
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

    const result = journalists.map((j) => ({
      id: j.id,
      journalistName: j.journalist_name,
      firstName: j.first_name,
      lastName: j.last_name,
      entityType: j.entity_type,
      emails: emailsByJournalist.get(j.id as string) || [],
    }));

    res.json({ journalists: result });
  }
);

// GET /internal/journalists/by-ids
router.get("/internal/journalists/by-ids", async (req, res) => {
  const idsParam = req.query.ids as string;
  if (!idsParam) {
    res.status(400).json({ error: "ids query parameter is required" });
    return;
  }

  const ids = idsParam.split(",").map((id) => id.trim());
  if (ids.length === 0) {
    res.json({ journalists: [] });
    return;
  }

  const journalists = await db
    .select()
    .from(pressJournalists)
    .where(inArray(pressJournalists.id, ids));

  res.json({ journalists });
});

export default router;
