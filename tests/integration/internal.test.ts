import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestJournalist,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();

const OUTLET_ID = "11111111-1111-1111-1111-111111111111";

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
});
