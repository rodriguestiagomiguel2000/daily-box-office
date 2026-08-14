import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { runMigrations } from "./server/migrate";
import { apiRouter } from "./server/api";
import { scheduler } from "./server/scheduler";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Run PostgreSQL migrations on startup
  try {
    await runMigrations();
    // Start in-memory scheduler if explicitly enabled or in development.
    // In production, collections are triggered externally via Cloud Scheduler -> POST /api/collector/cron
    if (process.env.ENABLE_IN_MEMORY_SCHEDULER === "true" || process.env.NODE_ENV !== "production") {
      scheduler.start(15);
    } else {
      console.log("In-memory setInterval scheduler disabled in production. Collections driven by external cron endpoint.");
    }
  } catch (err) {
    console.error("Database initialization failed:", err);
  }

  // Mount API router FIRST
  app.use("/api", apiRouter);

  // Health route
  app.get("/healthz", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
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
