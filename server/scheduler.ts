import { executeCollectionRun, getActiveProgress, CollectorJobResult } from "./collector";
import { computeRoomStructuralBlocks } from "./revenue";
import { executeRetentionPurge } from "./retention";
import { envConfig } from "./env";

class CollectorScheduler {
  private intervalMinutes: number = envConfig.COLLECTOR_INTERVAL_MINUTES || 20;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastRunTime: Date | null = null;
  private nextRunTime: Date | null = null;
  private lastRunResult: CollectorJobResult | null = null;
  private lastRetentionPurgeDate: string | null = null;

  public start(intervalMinutes: number = 20) {
    this.intervalMinutes = Math.max(1, intervalMinutes);
    this.isRunning = true;
    console.log(`Collector scheduler started with ${this.intervalMinutes}-minute interval.`);
    
    // Set next run time
    this.nextRunTime = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
    
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      this.triggerRun("SCHEDULED");
    }, this.intervalMinutes * 60 * 1000);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextRunTime = null;
    console.log("Collector scheduler stopped.");
  }

  public setIntervalMinutes(minutes: number) {
    const wasRunning = this.isRunning;
    this.intervalMinutes = Math.max(1, minutes);
    if (wasRunning) {
      this.start(this.intervalMinutes);
    }
  }

  public async triggerRun(triggerSource: "MANUAL" | "SCHEDULED" | "CRON" = "MANUAL"): Promise<CollectorJobResult> {
    const active = getActiveProgress();
    if (active.isCollecting) {
      console.warn("Collection already in progress. Skipping trigger.");
      return {
        runId: active.progress?.run_id || "skipped-" + Date.now(),
        status: "SKIPPED_BUSY",
        moviesFound: 0,
        sessionsAttempted: 0,
        sessionsSuccessful: 0,
        sessionsFailed: 0,
        snapshotsCreated: 0,
        errors: ["Collection is already running in background."],
        durationMs: 0,
      };
    }

    this.lastRunTime = new Date();
    if (this.isRunning) {
      this.nextRunTime = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
    }

    try {
      console.log(`Executing ${triggerSource} collection run...`);
      const result = await executeCollectionRun({ triggerSource });
      this.lastRunResult = result;

      // Trigger background recomputation of structural seat blocks (throttled internally to 6 hours)
      computeRoomStructuralBlocks().catch((err) => {
        console.error("[Scheduler] Error updating structural seat blocks:", err);
      });

      // Daily overnight retention purge on granular tables (03:00 - 05:00 Lisbon time lull)
      const lisbonHour = parseInt(
        new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Lisbon", hour: "numeric", hour12: false }).format(new Date()),
        10
      );
      const lisbonToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
      if (lisbonHour >= 3 && lisbonHour <= 5 && this.lastRetentionPurgeDate !== lisbonToday) {
        this.lastRetentionPurgeDate = lisbonToday;
        console.log(`[Scheduler] Overnight maintenance window (Lisbon hour ${lisbonHour}): triggering 45-day retention purge...`);
        executeRetentionPurge({ retentionDays: 45 }).catch((err) => {
          console.error("[Scheduler] Error executing daily overnight retention purge:", err);
        });
      }

      return result;
    } catch (err: any) {
      console.error(`Collection run (${triggerSource}) encountered error:`, err);
      const failedResult: CollectorJobResult = {
        runId: "error-" + Date.now(),
        status: "FAILED",
        moviesFound: 0,
        sessionsAttempted: 0,
        sessionsSuccessful: 0,
        sessionsFailed: 0,
        snapshotsCreated: 0,
        errors: [err.message || String(err)],
        durationMs: 0,
      };
      this.lastRunResult = failedResult;
      return failedResult;
    }
  }

  public getStatus() {
    const active = getActiveProgress();
    return {
      isRunning: this.isRunning,
      isCollecting: active.isCollecting,
      intervalMinutes: this.intervalMinutes,
      lastRunTime: this.lastRunTime ? this.lastRunTime.toISOString() : null,
      nextRunTime: this.nextRunTime ? this.nextRunTime.toISOString() : null,
      lastRunResult: this.lastRunResult,
      activeProgress: active.progress,
      lastRetentionPurgeDate: this.lastRetentionPurgeDate,
      collectorVersion: "2.0.0",
    };
  }
}

export const scheduler = new CollectorScheduler();
