import { db, sql } from "../../src/db/index.js";
import {
  journalists,
  campaignJournalists,
  discoveryCache,
} from "../../src/db/schema.js";

export async function cleanTestData() {
  await db.delete(discoveryCache);
  await db.delete(campaignJournalists);
  await db.delete(journalists);
}

export async function insertTestJournalist(
  data: {
    outletId: string;
    entityType?: "individual" | "organization";
    journalistName?: string;
    firstName?: string;
    lastName?: string;
  }
) {
  const [journalist] = await db
    .insert(journalists)
    .values({
      outletId: data.outletId,
      entityType: data.entityType || "individual",
      journalistName:
        data.journalistName || `Test Journalist ${Date.now()}-${Math.random()}`,
      firstName: data.firstName || "Test",
      lastName: data.lastName || "Journalist",
    })
    .returning();
  return journalist;
}

export async function closeDb() {
  await sql.end();
}
