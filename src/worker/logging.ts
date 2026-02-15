/**
 * Job execution context — AsyncLocalStorage-based mechanism for tracking
 * which job is currently running. Console interception pushes entries into
 * the context's log buffer, and the flush step (future) writes them to the
 * database.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Job, LogLevel, NewJobLog } from "../types.js";
import type { DatabaseAdapter } from "../db/adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
};

export type JobContext = {
  readonly jobId: string;
  readonly attempt: number;
  logs: LogEntry[];
};

// ---------------------------------------------------------------------------
// Storage (internal singleton)
// ---------------------------------------------------------------------------

const jobStorage = new AsyncLocalStorage<JobContext>();

let installed = false;

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function captureLog(level: LogLevel, args: unknown[]): void {
  const context = jobStorage.getStore();
  if (!context) return;

  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        const json = JSON.stringify(arg);
        return json === undefined ? String(arg) : json;
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  context.logs.push({ level, message, timestamp: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside a job execution context. The context is available via
 * `getJobContext()` for the duration of `fn` (including across async
 * boundaries). Returns the context after `fn` completes so the caller
 * can inspect accumulated logs. Re-throws if `fn` throws.
 */
export async function withJobContext(
  job: Job,
  fn: () => Promise<void>,
): Promise<JobContext> {
  const context: JobContext = {
    jobId: job.id,
    attempt: job.attempts,
    logs: [],
  };

  await jobStorage.run(context, fn);

  return context;
}

/**
 * Retrieve the current job context, or `undefined` if called outside
 * of a `withJobContext` scope.
 */
export function getJobContext(): JobContext | undefined {
  return jobStorage.getStore();
}

/**
 * Patch `console.log/warn/error` to capture output into the active job
 * context's log buffer. Idempotent — safe to call multiple times.
 * Original console output is never silenced.
 */
export function installConsoleInterceptors(): void {
  if (installed) return;
  installed = true;

  console.log = (...args: unknown[]) => {
    captureLog("info", args);
    originalConsole.log(...args);
  };
  console.warn = (...args: unknown[]) => {
    captureLog("warn", args);
    originalConsole.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    captureLog("error", args);
    originalConsole.error(...args);
  };
}

/**
 * Restore the original `console.log/warn/error` methods.
 * Idempotent — safe to call even if interceptors were never installed.
 */
export function removeConsoleInterceptors(): void {
  if (!installed) return;
  installed = false;

  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}

/**
 * Flush buffered log entries from a job context to the database.
 * Clears the buffer before the async write to prevent double-flush.
 * Errors are swallowed (logged via originalConsole.error) so log
 * persistence never crashes the job.
 */
export async function flushLogs(
  context: JobContext,
  adapter: DatabaseAdapter,
): Promise<void> {
  if (context.logs.length === 0) return;

  const logs: NewJobLog[] = context.logs.map((entry) => ({
    job_id: context.jobId,
    attempt: context.attempt,
    level: entry.level,
    message: entry.message,
    timestamp: entry.timestamp,
  }));

  context.logs = [];

  try {
    await adapter.insertLogs(logs);
  } catch (error) {
    originalConsole.error("[dashq] Failed to flush job logs:", error);
  }
}
