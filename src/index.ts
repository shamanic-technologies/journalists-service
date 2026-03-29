import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";
import healthRoutes from "./routes/health.js";
import internalRoutes from "./routes/internal.js";
import bufferNextRoutes from "./routes/buffer-next.js";
import discoverRoutes from "./routes/discover.js";
import campaignOutletJournalistsRoutes from "./routes/campaign-outlet-journalists.js";
import statsRoutes from "./routes/stats.js";
import { requireApiKey, requireIdentityHeaders } from "./middleware/auth.js";

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

// Protected routes (API key required)
app.use(requireApiKey);

// Public stats — API key only, no identity headers needed
app.get("/stats/public", statsRoutes);

// Private routes — require identity headers
app.use(requireIdentityHeaders);
app.use(statsRoutes);
app.use(bufferNextRoutes);
app.use(discoverRoutes);
app.use(campaignOutletJournalistsRoutes);
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

// Startup env var validation
function validateEnvVars(): void {
  const required = [
    "JOURNALISTS_SERVICE_API_KEY",
    "JOURNALISTS_SERVICE_DATABASE_URL",
    "RUNS_SERVICE_URL",
    "RUNS_SERVICE_API_KEY",
    "BRAND_SERVICE_URL",
    "BRAND_SERVICE_API_KEY",
    "CAMPAIGN_SERVICE_URL",
    "CAMPAIGN_SERVICE_API_KEY",
    "OUTLETS_SERVICE_URL",
    "OUTLETS_SERVICE_API_KEY",
    "ARTICLES_SERVICE_URL",
    "ARTICLES_SERVICE_API_KEY",
    "CHAT_SERVICE_URL",
    "CHAT_SERVICE_API_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `[journalists-service] FATAL: missing required env vars (${missing.length}): ${missing.join(", ")}`
    );
    process.exit(1);
  }
  console.log("[journalists-service] All required env vars present");
}

// Start server (not in test)
if (process.env.NODE_ENV !== "test") {
  validateEnvVars();
  migrate(db, { migrationsFolder: "./drizzle" })
    .then(() => {
      console.log("[journalists-service] Migrations complete");
      app.listen(Number(PORT), "::", () => {
        console.log(`[journalists-service] Running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

export default app;
