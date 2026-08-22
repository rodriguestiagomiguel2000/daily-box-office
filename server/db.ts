import pg from "pg";
const { Pool } = pg;

// Use DATABASE_URL with standard SSL configuration for Neon / PostgreSQL
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL is not set. Database persistence will be unavailable until configured.");
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Handle idle client background errors to prevent unhandled process crashes
pool.on("error", (err) => {
  console.error("Unexpected background idle PostgreSQL client error:", err.message);
});

export async function query<T = any>(
  text: string,
  params?: any[],
  retries = 2
): Promise<pg.QueryResult<T>> {
  let attempt = 0;
  while (true) {
    const start = Date.now();
    try {
      const res = await pool.query<T>(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`Slow query (${duration}ms): ${text.slice(0, 100)}`);
      }
      return res;
    } catch (error: any) {
      const isConnectionError =
        error?.code === "ECONNRESET" ||
        error?.code === "EPIPE" ||
        error?.code === "57P01" || // admin shutdown
        error?.message?.includes("ECONNRESET") ||
        error?.message?.includes("Connection terminated unexpectedly") ||
        error?.message?.includes("timeout");

      if (attempt < retries && isConnectionError) {
        attempt++;
        console.warn(`Transient database error (${error.message || error.code}). Retrying attempt ${attempt}/${retries}...`);
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        continue;
      }

      console.error(`Database query error: ${text.slice(0, 100)}`, error);
      throw error;
    }
  }
}

