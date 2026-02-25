import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, AUTH_HEADERS } from "../helpers/test-app.js";
import { cleanTestData, insertTestJournalist, closeDb } from "../helpers/test-db.js";

const app = createTestApp();

describe("Journalists CRUD", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("POST /journalists", () => {
    it("creates a journalist", async () => {
      const res = await request(app)
        .post("/journalists")
        .set(AUTH_HEADERS)
        .send({
          entityType: "individual",
          journalistName: "Jane Doe",
          firstName: "Jane",
          lastName: "Doe",
        });

      expect(res.status).toBe(201);
      expect(res.body.journalist).toMatchObject({
        entityType: "individual",
        journalistName: "Jane Doe",
        firstName: "Jane",
        lastName: "Doe",
      });
      expect(res.body.journalist.id).toBeDefined();
    });

    it("returns 409 for duplicate journalist name+type", async () => {
      await request(app).post("/journalists").set(AUTH_HEADERS).send({
        entityType: "individual",
        journalistName: "Jane Doe",
      });

      const res = await request(app)
        .post("/journalists")
        .set(AUTH_HEADERS)
        .send({
          entityType: "individual",
          journalistName: "Jane Doe",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/journalists")
        .set(AUTH_HEADERS)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 401 without api key", async () => {
      const res = await request(app).post("/journalists").send({
        entityType: "individual",
        journalistName: "Jane Doe",
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /journalists", () => {
    it("lists all journalists", async () => {
      await insertTestJournalist({ journalistName: "J1" });
      await insertTestJournalist({ journalistName: "J2" });

      const res = await request(app)
        .get("/journalists")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toHaveLength(2);
    });

    it("filters by entity_type", async () => {
      await insertTestJournalist({
        journalistName: "J1",
        entityType: "individual",
      });
      await insertTestJournalist({
        journalistName: "J2",
        entityType: "organization",
      });

      const res = await request(app)
        .get("/journalists?entity_type=individual")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toHaveLength(1);
      expect(res.body.journalists[0].entityType).toBe("individual");
    });

    it("returns empty array when no journalists", async () => {
      const res = await request(app)
        .get("/journalists")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalists).toEqual([]);
    });
  });

  describe("GET /journalists/:id", () => {
    it("returns journalist by id", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "Jane",
      });

      const res = await request(app)
        .get(`/journalists/${journalist.id}`)
        .set(AUTH_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.journalist.id).toBe(journalist.id);
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app)
        .get("/journalists/00000000-0000-0000-0000-000000000000")
        .set(AUTH_HEADERS);

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /journalists/:id", () => {
    it("updates journalist fields", async () => {
      const journalist = await insertTestJournalist({
        journalistName: "Old Name",
      });

      const res = await request(app)
        .patch(`/journalists/${journalist.id}`)
        .set(AUTH_HEADERS)
        .send({ journalistName: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.journalist.journalistName).toBe("New Name");
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await request(app)
        .patch("/journalists/00000000-0000-0000-0000-000000000000")
        .set(AUTH_HEADERS)
        .send({ journalistName: "X" });

      expect(res.status).toBe(404);
    });
  });
});
