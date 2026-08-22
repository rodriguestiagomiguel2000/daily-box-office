import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { envConfig } from "./server/env";
import { runMigrations } from "./server/migrate";
import { apiRouter } from "./server/api";
import { scheduler } from "./server/scheduler";

async function startServer() {
  const app = express();
  const PORT = envConfig.PORT || 3000;

  app.use(express.json());

  // Run PostgreSQL migrations on startup
  try {
    await runMigrations();
    // In-memory scheduler is DISABLED by default.
    // In the AI Studio hosted environment (.ai.studio) and standard runtime,
    // do NOT spawn automatic SCHEDULED background runs.
    // Collections are strictly driven by POST /api/collector/cron or manual triggers.
    console.log("[SCHEDULER] In-memory setInterval scheduler is disabled by default. Collections are driven via POST /api/collector/cron.");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }

  // Mount API router FIRST
  app.use("/api", apiRouter);

  // Health route
  app.get("/healthz", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // Explicit safeguard: ensure /api routes never fall through to Vite SPA html handler
  app.all("/api/*all", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware for development vs static dist for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", port: 3000 },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Portugal Box Office Tracker server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
