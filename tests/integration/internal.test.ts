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

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OUTLET_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BRAND_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BRAND_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CAMPAIGN_1 = "11111111-0000-0000-0000-000000000001";
const CAMPAIGN_2 = "11111111-0000-0000-0000-000000000002";

describe("Internal Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /internal/outlets/contacted", () => {
    it("returns contacted=true when a contacted journalist exists for overlapping brand", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "ContactedJ" });
      await insertTestCampaignJournalist({
        journalistId: j.id,
        orgId: ORG_ID,
        brandIds: [BRAND_A, BRAND_B],
        campaignId: CAMPAIGN_1,
        outletId: OUTLET_ID,
        status: "contacted",
      });

      const res = await request(app)
        .get(`/internal/outlets/contacted?org_id=${ORG_ID}&brand_ids=${BRAND_B}&outlet_id=${OUTLET_ID}&exclude_campaign_id=${CAMPAIGN_2}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.contacted).toBe(true);
    });

    it("returns contacted=false when no contacted journalist exists", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "BufferedJ" });
      await insertTestCampaignJournalist({
        journalistId: j.id,
        orgId: ORG_ID,
        brandIds: [BRAND_A],
        campaignId: CAMPAIGN_1,
        outletId: OUTLET_ID,
        status: "buffered",
      });

      const res = await request(app)
        .get(`/internal/outlets/contacted?org_id=${ORG_ID}&brand_ids=${BRAND_A}&outlet_id=${OUTLET_ID}&exclude_campaign_id=${CAMPAIGN_2}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.contacted).toBe(false);
    });

    it("excludes the specified campaign from the check", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "SelfJ" });
      await insertTestCampaignJournalist({
        journalistId: j.id,
        orgId: ORG_ID,
        brandIds: [BRAND_A],
        campaignId: CAMPAIGN_1,
        outletId: OUTLET_ID,
        status: "contacted",
      });

      // Excluding CAMPAIGN_1 should return false since that's the only contacted row
      const res = await request(app)
        .get(`/internal/outlets/contacted?org_id=${ORG_ID}&brand_ids=${BRAND_A}&outlet_id=${OUTLET_ID}&exclude_campaign_id=${CAMPAIGN_1}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.contacted).toBe(false);
    });

    it("returns contacted=false when brands do not overlap", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "NoOverlapJ" });
      await insertTestCampaignJournalist({
        journalistId: j.id,
        orgId: ORG_ID,
        brandIds: [BRAND_A],
        campaignId: CAMPAIGN_1,
        outletId: OUTLET_ID,
        status: "contacted",
      });

      const res = await request(app)
        .get(`/internal/outlets/contacted?org_id=${ORG_ID}&brand_ids=${BRAND_C}&outlet_id=${OUTLET_ID}&exclude_campaign_id=${CAMPAIGN_2}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.contacted).toBe(false);
    });

    it("returns contacted=false for a different org", async () => {
      const OTHER_ORG = "99999999-9999-9999-9999-999999999999";
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "OtherOrgJ" });
      await insertTestCampaignJournalist({
        journalistId: j.id,
        orgId: ORG_ID,
        brandIds: [BRAND_A],
        campaignId: CAMPAIGN_1,
        outletId: OUTLET_ID,
        status: "contacted",
      });

      const res = await request(app)
        .get(`/internal/outlets/contacted?org_id=${OTHER_ORG}&brand_ids=${BRAND_A}&outlet_id=${OUTLET_ID}&exclude_campaign_id=${CAMPAIGN_2}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.contacted).toBe(false);
    });

    it("returns 400 with missing required params", async () => {
      const res = await request(app)
        .get("/internal/outlets/contacted")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(400);
    });

    it("supports multiple brand_ids in CSV", async () => {
      const j = await insertTestJournalist({ outletId: OUTLET_ID, journalistName: "MultiBrandJ" });
      await insertTestCampaignJournalist({
        journalistId: j.id,
        orgId: ORG_ID,
        brandIds: [BRAND_B],
        campaignId: CAMPAIGN_1,
        outletId: OUTLET_ID,
        status: "contacted",
      });

      // Query with BRAND_A,BRAND_B — should overlap with BRAND_B
      const res = await request(app)
        .get(`/internal/outlets/contacted?org_id=${ORG_ID}&brand_ids=${BRAND_A},${BRAND_B}&outlet_id=${OUTLET_ID}&exclude_campaign_id=${CAMPAIGN_2}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.contacted).toBe(true);
    });
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
});
