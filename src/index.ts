/**
 * DashQ — Database-first functional job queue for Node.js
 *
 * Public API entry point.
 */

export const VERSION = "0.0.1";

// Types
export type {
  JobStatus,
  LogLevel,
  Job,
  NewJob,
  JobLog,
  NewJobLog,
  JobFilter,
  WorkerInfo,
  BackoffStrategy,
  JobOptions,
  RegisteredJob,
  JobDefinition,
  WorkerOptions,
  RetentionOptions,
  CleanupResult,
} from "./types.js";

// Database
export type { DatabaseAdapter, DatabaseConfig } from "./db/adapter.js";
export { createSqliteAdapter } from "./db/sqlite-adapter.js";
export { createPostgresAdapter } from "./db/postgres-adapter.js";
export { createAdapter } from "./db/create-adapter.js";
export { generateId } from "./db/uuid.js";

// Core
export { defineJob } from "./core/define-job.js";
export { setAdapter } from "./core/db-state.js";
export { waitForJob } from "./core/wait-for-job.js";
export type { WaitForJobOptions } from "./core/wait-for-job.js";

// Worker
export { createWorker } from "./worker/worker.js";
export type { Worker } from "./worker/worker.js";
export {
  installConsoleInterceptors,
  removeConsoleInterceptors,
} from "./worker/logging.js";

// Dashboard
export { createDashboardPlugin } from "./dashboard/plugin.js";
export type { DashboardPluginOptions } from "./dashboard/plugin.js";

// Cleanup
export { createCleanupScheduler } from "./cleanup.js";
export type { CleanupScheduler } from "./cleanup.js";

// Utilities
export { parseDuration } from "./utils.js";

// Start
export { start } from "./start.js";
export type { StartOptions, DashQHandle } from "./config.js";
