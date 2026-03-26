import express from "express";
import cors from "cors";
import healthRoutes from "../../src/routes/health.js";
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
  app.use(discoverRoutes);
  app.use(discoverJournalistsRoutes);
  app.use(resolveJournalistsRoutes);
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
  "x-feature-slug": "test-feature",
};
