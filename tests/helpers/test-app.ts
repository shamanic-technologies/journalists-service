import express from "express";
import cors from "cors";
import healthRoutes from "../../src/routes/health.js";
import journalistsRoutes from "../../src/routes/journalists.js";
import outletJournalistsRoutes from "../../src/routes/outlet-journalists.js";
import campaignOutletJournalistsRoutes from "../../src/routes/campaign-outlet-journalists.js";
import enrichedRoutes from "../../src/routes/enriched.js";
import emailPipelineRoutes from "../../src/routes/email-pipeline.js";
import engagementRoutes from "../../src/routes/engagement.js";
import internalRoutes from "../../src/routes/internal.js";
import discoverRoutes from "../../src/routes/discover.js";
import discoverJournalistsRoutes from "../../src/routes/discover-journalists.js";
import resolveJournalistsRoutes from "../../src/routes/resolve-journalists.js";
import { requireApiKey, requireIdentityHeaders } from "../../src/middleware/auth.js";

export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(healthRoutes);
  app.use(requireApiKey);
  app.use(requireIdentityHeaders);
  app.use(emailPipelineRoutes);
  app.use(engagementRoutes);
  app.use(discoverRoutes);
  app.use(discoverJournalistsRoutes);
  app.use(resolveJournalistsRoutes);
  app.use(journalistsRoutes);
  app.use(outletJournalistsRoutes);
  app.use(campaignOutletJournalistsRoutes);
  app.use(enrichedRoutes);
  app.use(internalRoutes);
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

export const AUTH_HEADERS = {
  "x-api-key": "test-api-key",
  "x-org-id": "test-org-id",
  "x-user-id": "test-user-id",
  "x-run-id": "test-run-id",
  "x-feature-slug": "test-feature",
};
