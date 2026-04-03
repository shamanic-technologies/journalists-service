import express from "express";
import cors from "cors";
import healthRoutes from "../../src/routes/health.js";
import internalRoutes from "../../src/routes/internal.js";
import bufferNextRoutes from "../../src/routes/buffer-next.js";
import discoverRoutes from "../../src/routes/discover.js";
import campaignOutletJournalistsRoutes from "../../src/routes/campaign-outlet-journalists.js";
import statsRoutes from "../../src/routes/stats.js";
import statsCostsRoutes from "../../src/routes/stats-costs.js";
import { requireApiKey, requireIdentityHeaders } from "../../src/middleware/auth.js";

export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(healthRoutes);
  app.use(requireApiKey);
  // Public stats — API key only
  app.get("/stats/public", statsRoutes);
  // Private routes — require identity headers
  app.use(requireIdentityHeaders);
  app.use(statsRoutes);
  app.use(statsCostsRoutes);
  app.use(bufferNextRoutes);
  app.use(discoverRoutes);
  app.use(campaignOutletJournalistsRoutes);
  app.use(internalRoutes);
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

export const AUTH_HEADERS = {
  "x-api-key": "test-api-key",
  "x-org-id": "22222222-2222-2222-2222-222222222222",
  "x-user-id": "33333333-3333-3333-3333-333333333333",
  "x-run-id": "99999999-9999-9999-9999-999999999999",
  "x-campaign-id": "55555555-5555-5555-5555-555555555555",
  "x-brand-id": "44444444-4444-4444-4444-444444444444",
  "x-feature-slug": "test-feature",
  "x-workflow-slug": "test-workflow",
};
