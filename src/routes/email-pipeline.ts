import { Router } from "express";
import { sql } from "../db/index.js";

const router = Router();

// GET /journalists/emails/valid
router.get("/journalists/emails/valid", async (req, res) => {
  const { outlet_id, journalist_id } = req.query as {
    outlet_id?: string;
    journalist_id?: string;
  };

  const conditions: string[] = [];
  const params: string[] = [];

  if (outlet_id) {
    params.push(outlet_id);
    conditions.push(`outlet_id = $${params.length}`);
  }
  if (journalist_id) {
    params.push(journalist_id);
    conditions.push(`journalist_id = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await sql.unsafe(
    `SELECT journalist_id, outlet_id, email, is_valid, type, source, confidence FROM v_valid_journalist_emails ${where}`,
    params
  );

  res.json({ emails: rows });
});

// GET /journalists/emails/enrichment-events
router.get("/journalists/emails/enrichment-events", async (req, res) => {
  const { outlet_id, journalist_id } = req.query as {
    outlet_id?: string;
    journalist_id?: string;
  };

  const conditions: string[] = [];
  const params: string[] = [];

  if (outlet_id) {
    params.push(outlet_id);
    conditions.push(`outlet_id = $${params.length}`);
  }
  if (journalist_id) {
    params.push(journalist_id);
    conditions.push(`journalist_id = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await sql.unsafe(
    `SELECT outlet_id, journalist_id, email, enriched_at, status, score, accept_all FROM v_outlet_journalist_enriched_emails_events ${where}`,
    params
  );

  res.json({ events: rows });
});

// GET /journalists/emails/enriched-individual-events
router.get(
  "/journalists/emails/enriched-individual-events",
  async (req, res) => {
    const { outlet_id, journalist_id } = req.query as {
      outlet_id?: string;
      journalist_id?: string;
    };

    const conditions: string[] = [];
    const params: string[] = [];

    if (outlet_id) {
      params.push(outlet_id);
      conditions.push(`outlet_id = $${params.length}`);
    }
    if (journalist_id) {
      params.push(journalist_id);
      conditions.push(`journalist_id = $${params.length}`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await sql.unsafe(
      `SELECT outlet_id, journalist_id, first_name, last_name, domain, enriched_at, position, verification_status, score FROM v_outlet_journalist_enriched_events ${where}`,
      params
    );

    res.json({ events: rows });
  }
);

// GET /journalists/emails/searched-events
router.get("/journalists/emails/searched-events", async (req, res) => {
  const { outlet_id, journalist_id } = req.query as {
    outlet_id?: string;
    journalist_id?: string;
  };

  const conditions: string[] = [];
  const params: string[] = [];

  if (outlet_id) {
    params.push(outlet_id);
    conditions.push(`outlet_id = $${params.length}`);
  }
  if (journalist_id) {
    params.push(journalist_id);
    conditions.push(`journalist_id = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await sql.unsafe(
    `SELECT outlet_id, journalist_id, journalist_email, searched_at, source_status, source_quote FROM v_outlet_journalist_searched_emails_events ${where}`,
    params
  );

  res.json({ events: rows });
});

// GET /journalists/need-email-update
router.get("/journalists/need-email-update", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;

  const rows = await sql.unsafe(
    `SELECT outlet_id, journalist_id, journalist_name, first_name, last_name, last_searched_at, last_enriched_at FROM v_outlet_journalists_need_email_update_status LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  res.json({ journalists: rows });
});

// GET /journalists/need-enrichment
router.get("/journalists/need-enrichment", async (_req, res) => {
  const rows = await sql.unsafe(
    `SELECT outlet_id, journalist_id, journalist_name, first_name, last_name FROM v_outlet_journalists_need_enrichment_status`
  );

  res.json({ journalists: rows });
});

// GET /journalists/need-agent-search
router.get("/journalists/need-agent-search", async (_req, res) => {
  const rows = await sql.unsafe(
    `SELECT outlet_id, journalist_id, journalist_name, first_name, last_name FROM v_outlet_journalists_need_agent_search_status`
  );

  res.json({ journalists: rows });
});

// GET /journalists/emails/need-verification
router.get(
  "/journalists/emails/need-verification",
  async (_req, res) => {
    const rows = await sql.unsafe(
      `SELECT outlet_id, journalist_id, email FROM v_outlet_journalists_emails_need_verification_status`
    );

    res.json({ emails: rows });
  }
);

export default router;
