import { Router } from "express";
import { sql } from "../db/index.js";

const router = Router();

// GET /journalists/engagement/:journalistId
router.get("/journalists/engagement/:journalistId", async (req, res) => {
  const { journalistId } = req.params;

  const userEngagement = await sql.unsafe(
    `SELECT journalist_id, journalist_name, total_pitches, total_opens, total_replies, last_engagement_at
     FROM v_journalists_user_engagement
     WHERE journalist_id = $1`,
    [journalistId]
  );

  const engagement = await sql.unsafe(
    `SELECT journalist_id, journalist_name, pitch_bounces, deliveries, last_engagement_at
     FROM v_journalists_engagement
     WHERE journalist_id = $1`,
    [journalistId]
  );

  if (userEngagement.length === 0 && engagement.length === 0) {
    res.status(404).json({ error: "Journalist not found" });
    return;
  }

  const ue = userEngagement[0] || {};
  const e = engagement[0] || {};

  res.json({
    engagement: {
      journalistId,
      journalistName: ue.journalist_name || e.journalist_name || "",
      pitchBounces: Number(e.pitch_bounces || 0),
      deliveries: Number(e.deliveries || 0),
      lastEngagementAt: ue.last_engagement_at || e.last_engagement_at || null,
      totalPitches: Number(ue.total_pitches || 0),
      totalOpens: Number(ue.total_opens || 0),
      totalReplies: Number(ue.total_replies || 0),
    },
  });
});

// GET /journalists/status
router.get("/journalists/status", async (req, res) => {
  const { campaign_id } = req.query as { campaign_id?: string };

  let rows;
  if (campaign_id) {
    rows = await sql.unsafe(
      `SELECT campaign_id, outlet_id, journalist_id, journalist_name, status, relevance_score
       FROM v_journalists_status
       WHERE campaign_id = $1`,
      [campaign_id]
    );
  } else {
    rows = await sql.unsafe(
      `SELECT campaign_id, outlet_id, journalist_id, journalist_name, status, relevance_score
       FROM v_journalists_status`
    );
  }

  res.json({ statuses: rows });
});

export default router;
