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
