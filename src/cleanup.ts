/**
 * Retention and cleanup logic for DashQ.
 *
 * Provides a functional cleanup scheduler that periodically deletes old
 * succeeded/failed jobs and log entries based on configurable retention
 * periods. Deletion is batched to avoid locking the database for long
 * periods.
 */

import type { DatabaseAdapter } from "./db/adapter.js";
import type { RetentionOptions, CleanupResult, JobStatus } from "./types.js";
import { parseDuration } from "./utils.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SUCCEEDED_RETENTION = "7d";
const DEFAULT_FAILED_RETENTION = "14d";
const DEFAULT_LOG_RETENTION = "14d";
const DEFAULT_CLEANUP_INTERVAL = "1h";
const DEFAULT_BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CleanupScheduler = {
  /** Start the automatic cleanup interval. */
  start(): void;
  /** Stop the automatic cleanup interval. */
  stop(): void;
  /** Run a single cleanup cycle (also used for on-demand cleanup). */
  runOnce(): Promise<CleanupResult>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function deleteJobsInBatches(
  adapter: DatabaseAdapter,
  olderThan: Date,
  statuses: JobStatus[],
  batchSize: number,
): Promise<number> {
  let totalDeleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const deleted = await adapter.deleteOldJobs(olderThan, statuses);
    totalDeleted += deleted;
    if (deleted < batchSize) break;
  }

  return totalDeleted;
}

// ---------------------------------------------------------------------------
// Core cleanup run
// ---------------------------------------------------------------------------

export async function runCleanup(
  adapter: DatabaseAdapter,
  options: RetentionOptions = {},
): Promise<CleanupResult> {
  const now = Date.now();
  const batchSize = options.cleanupBatchSize ?? DEFAULT_BATCH_SIZE;

  const succeededMs = parseDuration(
    options.succeededJobRetention ?? DEFAULT_SUCCEEDED_RETENTION,
  );
  const failedMs = parseDuration(
    options.failedJobRetention ?? DEFAULT_FAILED_RETENTION,
  );
  const logMs = parseDuration(options.logRetention ?? DEFAULT_LOG_RETENTION);

  // Delete succeeded jobs
  const succeededDeleted = await deleteJobsInBatches(
    adapter,
    new Date(now - succeededMs),
    ["succeeded"],
    batchSize,
  );

  // Delete failed jobs
  const failedDeleted = await deleteJobsInBatches(
    adapter,
    new Date(now - failedMs),
    ["failed"],
    batchSize,
  );

  // Delete old logs
  const logsDeleted = await adapter.deleteOldLogs(new Date(now - logMs));

  return {
    jobsDeleted: succeededDeleted + failedDeleted,
    logsDeleted,
  };
}

// ---------------------------------------------------------------------------
// Scheduler factory
// ---------------------------------------------------------------------------

export function createCleanupScheduler(
  adapter: DatabaseAdapter,
  options: RetentionOptions = {},
): CleanupScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runOnce(): Promise<CleanupResult> {
    return runCleanup(adapter, options);
  }

  function tick(): void {
    runOnce()
      .then((result) => {
        if (result.jobsDeleted > 0 || result.logsDeleted > 0) {
          console.log(
            `[dashq] Cleanup: deleted ${result.jobsDeleted} jobs, ${result.logsDeleted} logs`,
          );
        }
      })
      .catch((error) => {
        console.error("[dashq] Cleanup failed:", error);
      });
  }

  function start(): void {
    if (timer) return;
    const intervalMs = parseDuration(
      options.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
    );
    timer = setInterval(tick, intervalMs);
    // Don't block process exit
    if (timer && typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runOnce };
}
