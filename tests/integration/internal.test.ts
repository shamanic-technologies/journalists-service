import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  insertTestCampaignJournalist,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const BRAND_ID = "44444444-4444-4444-4444-444444444444";
const CAMPAIGN_ID = "55555555-5555-5555-5555-555555555555";

describe("Internal Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /internal/journalists/by-ids", () => {
    it("batch lookups by comma-separated IDs", async () => {
      const j1 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Batch1" });
      const j2 = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Batch2" });

      const res = await request(app)
        .get(`/internal/journalists/by-ids?ids=${j1.id},${j2.id}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toHaveLength(2);
    });

    it("returns 400 without ids param", async () => {
      const res = await request(app)
        .get("/internal/journalists/by-ids")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /internal/campaign-journalists/:id/contacted", () => {
    it("transitions served → contacted", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Contact Me" });
      const cj = await insertTestCampaignJournalist({
        journalistId: j.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID, status: "served",
      });

      const res = await request(app)
        .patch(`/internal/campaign-journalists/${cj.id}/contacted`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app)
        .patch("/internal/campaign-journalists/00000000-0000-0000-0000-000000000000/contacted")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(404);
    });

    it("returns 409 when status is not served (buffered)", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Still Buffered" });
      const cj = await insertTestCampaignJournalist({
        journalistId: j.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID, status: "buffered",
      });

      const res = await request(app)
        .patch(`/internal/campaign-journalists/${cj.id}/contacted`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("buffered");
    });

    it("returns 409 when already contacted", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "Already Contacted" });
      const cj = await insertTestCampaignJournalist({
        journalistId: j.id, orgId: ORG_ID, brandId: BRAND_ID, campaignId: CAMPAIGN_ID,
        outletId: OUTLET_ID, status: "contacted",
      });

      const res = await request(app)
        .patch(`/internal/campaign-journalists/${cj.id}/contacted`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("contacted");
    });
  });
});
