import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import { cleanTestData, insertTestJournalist, closeDb } from "../helpers/test-db.js";

const app = createTestApp();

describe("Outlet Journalists", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  const OUTLET_ID = "11111111-1111-1111-1111-111111111111";

  describe("POST /outlet-journalists", () => {
    it("links journalist to outlet", async () => {
      const journalist = await insertTestJournalist();

      const res = await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send({
          outletId: OUTLET_ID,
          journalistId: journalist.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.outletJournalist).toMatchObject({
        outletId: OUTLET_ID,
        journalistId: journalist.id,
      });
    });

    it("is idempotent on duplicate", async () => {
      const journalist = await insertTestJournalist();
      const body = { outletId: OUTLET_ID, journalistId: journalist.id };

      await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send(body);

      const res = await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send(body);

      expect(res.status).toBe(201);
    });
  });

  describe("GET /outlet-journalists", () => {
    it("lists by outlet_id", async () => {
      const j1 = await insertTestJournalist({ journalistName: "OJ1" });
      const j2 = await insertTestJournalist({ journalistName: "OJ2" });

      await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send({ outletId: OUTLET_ID, journalistId: j1.id });
      await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send({ outletId: OUTLET_ID, journalistId: j2.id });

      const res = await request(app)
        .get(`/outlet-journalists?outlet_id=${OUTLET_ID}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.outletJournalists).toHaveLength(2);
      expect(res.body.outletJournalists[0].journalistName).toBeDefined();
    });

    it("lists by journalist_id", async () => {
      const journalist = await insertTestJournalist();
      await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send({ outletId: OUTLET_ID, journalistId: journalist.id });

      const res = await request(app)
        .get(`/outlet-journalists?journalist_id=${journalist.id}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.outletJournalists).toHaveLength(1);
    });
  });

  describe("DELETE /outlet-journalists/:outletId/:journalistId", () => {
    it("removes the link", async () => {
      const journalist = await insertTestJournalist();
      await request(app)
        .post("/outlet-journalists")
        .set(AUTH_HEADERS)
        .send({ outletId: OUTLET_ID, journalistId: journalist.id });

      const res = await request(app)
        .delete(`/outlet-journalists/${OUTLET_ID}/${journalist.id}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });

    it("returns 404 for nonexistent link", async () => {
      const res = await request(app)
        .delete(
          `/outlet-journalists/${OUTLET_ID}/00000000-0000-0000-0000-000000000000`
        )
        .set(AUTH_HEADERS);

      expect(res.status).toBe(404);
    });
  });
});
