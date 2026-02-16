/**
 * Worker engine — poll loop, job execution, retry logic, stale recovery,
 * and graceful shutdown.
 *
 * Functional factory (no classes). Call `createWorker(adapter, options?)`
 * to get a `{ start, stop }` handle.
 */

import type { DatabaseAdapter } from "../db/adapter.js";
import type { Job, WorkerInfo, WorkerOptions } from "../types.js";
import { generateId } from "../db/uuid.js";
import { getHandler } from "../core/registry.js";
import { calculateBackoff } from "./backoff.js";
import { withJobContext, getJobContext, flushLogs } from "./logging.js";
import type { JobContext } from "./logging.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLLING_INTERVAL = 1_000;
const DEFAULT_MAX_POLLING_INTERVAL = 30_000;
const DEFAULT_BACKOFF_MULTIPLIER = 1.5;
const DEFAULT_LEASE_TIMEOUT = 300_000; // 5 min
const DEFAULT_STALE_CHECK_INTERVAL = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Worker = {
  /** Non-blocking — kicks off the poll loop. Idempotent. */
  start(): void;
  /** Graceful shutdown — waits for in-flight job (with timeout). Idempotent. */
  stop(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorker(
  adapter: DatabaseAdapter,
  options?: WorkerOptions,
): Worker {
  // Resolve config
  const pollingInterval =
    options?.pollingInterval ?? DEFAULT_POLLING_INTERVAL;
  const maxPollingInterval =
    options?.maxPollingInterval ?? DEFAULT_MAX_POLLING_INTERVAL;
  const backoffMultiplier =
    options?.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const leaseTimeout = options?.leaseTimeout ?? DEFAULT_LEASE_TIMEOUT;
  const staleCheckInterval =
    options?.staleCheckInterval ?? DEFAULT_STALE_CHECK_INTERVAL;
  const shutdownTimeout =
    options?.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
  const concurrency = options?.concurrency ?? 1;

  // Worker identity
  const workerId = generateId();
  const workerInfo: WorkerInfo = {
    worker_id: workerId,
    lease_duration_ms: leaseTimeout,
  };

  // Mutable state
  let running = false;
  let currentInterval = pollingInterval;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  const inFlight = new Set<Promise<void>>();
  let polling = false;

  // -------------------------------------------------------------------------
  // Poll scheduling
  // -------------------------------------------------------------------------

  function schedulePoll(): void {
    if (!running) return;
    pollTimer = setTimeout(pollTick, currentInterval);
  }

  async function pollTick(): Promise<void> {
    if (polling || !running) return;
    polling = true;

    try {
      while (running && inFlight.size < concurrency) {
        const job = await adapter.claimNextJob(workerInfo);

        if (job) {
          currentInterval = pollingInterval; // reset backoff
          const promise = executeJob(job);
          inFlight.add(promise);
          promise.finally(() => {
            inFlight.delete(promise);
            if (running) schedulePoll(); // backfill freed slot
          });
        } else {
          // Adaptive backoff — no job found
          currentInterval = Math.min(
            currentInterval * backoffMultiplier,
            maxPollingInterval,
          );
          break;
        }
      }
    } catch {
      // DB error or unexpected failure — apply backoff, keep polling
      currentInterval = Math.min(
        currentInterval * backoffMultiplier,
        maxPollingInterval,
      );
    } finally {
      polling = false;
    }

    // Only schedule next poll if there are free slots.
    // When all slots are full, .finally() callbacks handle rescheduling.
    if (inFlight.size < concurrency) {
      schedulePoll();
    }
  }

  // -------------------------------------------------------------------------
  // Job execution
  // -------------------------------------------------------------------------

  async function executeJob(job: Job): Promise<void> {
    const registered = getHandler(job.job_type);
    if (!registered) {
      await adapter.markFailed(
        job.id,
        `No handler registered for job type: ${job.job_type}`,
      );
      return;
    }

    let args: unknown[];
    try {
      args = JSON.parse(job.args);
    } catch {
      await adapter.markFailed(
        job.id,
        `Failed to parse job arguments: ${job.args}`,
      );
      return;
    }

    let context: JobContext | undefined;
    let flushInterval: ReturnType<typeof setInterval> | null = null;
    try {
      await withJobContext(job, async () => {
        context = getJobContext();
        flushInterval = setInterval(async () => {
          if (context) await flushLogs(context, adapter);
        }, 2_000);
        await registered.handler(...args);
      });
      await adapter.markSucceeded(job.id);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? `${error.message}\n${error.stack}`
          : String(error);

      if (job.attempts < job.max_attempts) {
        // Retry with backoff
        const delay = calculateBackoff(
          job.attempts,
          registered.options.backoff,
        );
        const nextRunAt = new Date(Date.now() + delay).toISOString();
        await adapter.updateJob(job.id, {
          status: "queued",
          run_at: nextRunAt,
          locked_until: null,
          last_error: errorMessage,
        });
      } else {
        await adapter.markFailed(job.id, errorMessage);
      }
    } finally {
      if (flushInterval !== null) clearInterval(flushInterval);
      if (context) await flushLogs(context, adapter);
    }
  }

  // -------------------------------------------------------------------------
  // Stale recovery
  // -------------------------------------------------------------------------

  async function recoverStale(): Promise<void> {
    try {
      await adapter.recoverStaleJobs();
    } catch {
      // Silently ignore recovery errors — will retry next interval
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  function start(): void {
    if (running) return; // idempotent
    running = true;
    currentInterval = pollingInterval;
    staleTimer = setInterval(recoverStale, staleCheckInterval);
    schedulePoll();
  }

  async function stop(): Promise<void> {
    if (!running) return; // idempotent
    running = false;

    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (staleTimer !== null) {
      clearInterval(staleTimer);
      staleTimer = null;
    }

    // Wait for all in-flight jobs with timeout
    if (inFlight.size > 0) {
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, shutdownTimeout),
      );
      await Promise.race([Promise.allSettled([...inFlight]), timeout]);
    }
  }

  return { start, stop };
}
