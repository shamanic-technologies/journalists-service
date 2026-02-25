import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import { cleanTestData, insertTestJournalist, closeDb } from "../helpers/test-db.js";

const app = createTestApp();

describe("Campaign Outlet Journalists", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  const CAMPAIGN_ID = "22222222-2222-2222-2222-222222222222";
  const OUTLET_ID = "11111111-1111-1111-1111-111111111111";

  describe("POST /campaign-outlet-journalists", () => {
    it("creates a campaign-outlet-journalist link", async () => {
      const journalist = await insertTestJournalist();

      const res = await request(app)
        .post("/campaign-outlet-journalists")
        .set(AUTH_HEADERS)
        .send({
          campaignId: CAMPAIGN_ID,
          outletId: OUTLET_ID,
          journalistId: journalist.id,
          whyRelevant: "Covers tech",
          whyNotRelevant: "Sometimes off-topic",
          relevanceScore: 85.5,
        });

      expect(res.status).toBe(201);
      expect(res.body.campaignOutletJournalist).toMatchObject({
        campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID,
        journalistId: journalist.id,
        whyRelevant: "Covers tech",
      });
    });

    it("returns 400 for missing fields", async () => {
      const res = await request(app)
        .post("/campaign-outlet-journalists")
        .set(AUTH_HEADERS)
        .send({
          campaignId: CAMPAIGN_ID,
        });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /campaign-outlet-journalists", () => {
    it("lists by campaign_id", async () => {
      const journalist = await insertTestJournalist();

      await request(app)
        .post("/campaign-outlet-journalists")
        .set(AUTH_HEADERS)
        .send({
          campaignId: CAMPAIGN_ID,
          outletId: OUTLET_ID,
          journalistId: journalist.id,
          whyRelevant: "Covers tech",
          whyNotRelevant: "N/A",
          relevanceScore: 90,
        });

      const res = await request(app)
        .get(`/campaign-outlet-journalists?campaign_id=${CAMPAIGN_ID}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.campaignOutletJournalists).toHaveLength(1);
    });

    it("requires campaign_id", async () => {
      const res = await request(app)
        .get("/campaign-outlet-journalists")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /campaign-outlet-journalists/:campaignId/:outletId/:journalistId", () => {
    it("updates relevance", async () => {
      const journalist = await insertTestJournalist();

      await request(app)
        .post("/campaign-outlet-journalists")
        .set(AUTH_HEADERS)
        .send({
          campaignId: CAMPAIGN_ID,
          outletId: OUTLET_ID,
          journalistId: journalist.id,
          whyRelevant: "Old reason",
          whyNotRelevant: "N/A",
          relevanceScore: 50,
        });

      const res = await request(app)
        .patch(
          `/campaign-outlet-journalists/${CAMPAIGN_ID}/${OUTLET_ID}/${journalist.id}`
        )
        .set(AUTH_HEADERS)
        .send({
          whyRelevant: "Updated reason",
          relevanceScore: 95,
        });

      expect(res.status).toBe(200);
      expect(res.body.campaignOutletJournalist.whyRelevant).toBe(
        "Updated reason"
      );
    });

    it("returns 404 for nonexistent link", async () => {
      const res = await request(app)
        .patch(
          `/campaign-outlet-journalists/${CAMPAIGN_ID}/${OUTLET_ID}/00000000-0000-0000-0000-000000000000`
        )
        .set(AUTH_HEADERS)
        .send({ relevanceScore: 50 });

      expect(res.status).toBe(404);
    });
  });
});
