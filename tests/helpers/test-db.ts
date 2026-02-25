import { db, sql } from "../../src/db/index.js";
import {
  pressJournalists,
  outletJournalists,
  campaignOutletJournalists,
  enrichedIndividuals,
  enrichedEmails,
  searchedEmails,
} from "../../src/db/schema.js";

export async function cleanTestData() {
  await db.delete(searchedEmails);
  await db.delete(enrichedEmails);
  await db.delete(enrichedIndividuals);
  await db.delete(campaignOutletJournalists);
  await db.delete(outletJournalists);
  await db.delete(pressJournalists);
}

export async function insertTestJournalist(
  data: {
    entityType?: "individual" | "organization";
    journalistName?: string;
    firstName?: string;
    lastName?: string;
  } = {}
) {
  const [journalist] = await db
    .insert(pressJournalists)
    .values({
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
