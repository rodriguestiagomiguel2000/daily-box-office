/**
 * Environment configuration and validation schema.
 */

export interface AppEnvConfig {
  DATABASE_URL?: string;
  COLLECTOR_CRON_SECRET?: string;
  ENABLE_IN_MEMORY_SCHEDULER: boolean;
  NODE_ENV: string;
  PORT: number;
  APP_URL?: string;
  GEMINI_API_KEY?: string;
}

export function validateAndGetEnv(): AppEnvConfig {
  const config: AppEnvConfig = {
    DATABASE_URL: process.env.DATABASE_URL?.trim() || undefined,
    COLLECTOR_CRON_SECRET: process.env.COLLECTOR_CRON_SECRET?.trim() || undefined,
    ENABLE_IN_MEMORY_SCHEDULER: process.env.ENABLE_IN_MEMORY_SCHEDULER === "true",
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: 3000,
    APP_URL: process.env.APP_URL?.trim() || undefined,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY?.trim() || undefined,
  };

  // Diagnostic logging on server startup
  const checks = [
    { key: "DATABASE_URL", configured: Boolean(config.DATABASE_URL), critical: true },
    { key: "COLLECTOR_CRON_SECRET", configured: Boolean(config.COLLECTOR_CRON_SECRET), critical: false },
    { key: "ENABLE_IN_MEMORY_SCHEDULER", configured: config.ENABLE_IN_MEMORY_SCHEDULER, critical: false },
  ];

  for (const check of checks) {
    if (!check.configured) {
      if (check.critical) {
        console.warn(`[ENV WARNING] ${check.key} is not configured. Database persistence requires this variable.`);
      } else {
        console.info(`[ENV INFO] ${check.key} is not set.`);
      }
    }
  }

  return config;
}

export const envConfig = validateAndGetEnv();
