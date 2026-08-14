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
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function query<T = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`Slow query (${duration}ms): ${text.slice(0, 100)}`);
    }
    return res;
  } catch (error) {
    console.error(`Database query error: ${text.slice(0, 100)}`, error);
    throw error;
  }
}
