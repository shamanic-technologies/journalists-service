import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";
import healthRoutes from "./routes/health.js";
import journalistsRoutes from "./routes/journalists.js";
import outletJournalistsRoutes from "./routes/outlet-journalists.js";
import campaignOutletJournalistsRoutes from "./routes/campaign-outlet-journalists.js";
import huntedRoutes from "./routes/hunted.js";
import emailPipelineRoutes from "./routes/email-pipeline.js";
import engagementRoutes from "./routes/engagement.js";
import internalRoutes from "./routes/internal.js";
import discoverRoutes from "./routes/discover.js";
import { requireApiKey } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3020;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// OpenAPI spec (public)
const openapiPath = join(__dirname, "..", "openapi.json");
app.get("/openapi.json", (_req, res) => {
  if (existsSync(openapiPath)) {
    res.json(JSON.parse(readFileSync(openapiPath, "utf-8")));
  } else {
    res
      .status(404)
      .json({ error: "OpenAPI spec not generated. Run: pnpm generate:openapi" });
  }
});

// Public
app.use(healthRoutes);

// Protected routes
app.use(requireApiKey);
// Mount specific path routes before parametric /:id routes
app.use(emailPipelineRoutes);
app.use(engagementRoutes);
app.use(discoverRoutes);
app.use(journalistsRoutes);
app.use(outletJournalistsRoutes);
app.use(campaignOutletJournalistsRoutes);
app.use(huntedRoutes);
app.use(internalRoutes);

// 404
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Fallback error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

// Start server (not in test)
if (process.env.NODE_ENV !== "test") {
  migrate(db, { migrationsFolder: "./drizzle" })
    .then(() => {
      console.log("Migrations complete");
      app.listen(Number(PORT), "::", () => {
        console.log(`Journalists service running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

export default app;
