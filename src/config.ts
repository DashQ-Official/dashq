/**
 * Configuration types, parsing, and validation for DashQ.
 */

import type { DatabaseAdapter } from "./db/adapter.js";
import type { DatabaseConfig } from "./db/adapter.js";
import type { WorkerOptions, RetentionOptions, CleanupResult } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StartOptions = {
  /** Database connection string: "file:jobs.db", "postgres://...", etc. */
  database: string;
  /** Enable dashboard. Pass object for options like basePath. Default: true */
  dashboard?: boolean | { basePath?: string };
  /** Enable worker. Pass object for WorkerOptions. Default: true */
  worker?: boolean | WorkerOptions;
  /** Dashboard server port. Default: 3000 */
  port?: number;
  /** Dashboard server host. Default: "localhost" */
  host?: string;
  /** Retention / cleanup options. `true` uses defaults, `false` disables. Default: true */
  retention?: boolean | RetentionOptions;
};

export type DashQHandle = {
  /** Graceful shutdown — stops worker, server, and closes DB. */
  stop(): Promise<void>;
  /** Run cleanup on demand. Returns counts of deleted rows. */
  cleanup(): Promise<CleanupResult>;
  /** Actual port the dashboard is listening on (0 if dashboard disabled). */
  readonly port: number;
  /** The database adapter instance for advanced usage. */
  readonly adapter: DatabaseAdapter;
};

// ---------------------------------------------------------------------------
// Database config parsing
// ---------------------------------------------------------------------------

export function parseDatabaseConfig(database: string): DatabaseConfig {
  if (
    database.startsWith("postgres://") ||
    database.startsWith("postgresql://")
  ) {
    return { type: "postgres", connectionString: database };
  }
  return { type: "sqlite", path: database.replace(/^file:/, "") };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateConfig(options: StartOptions): void {
  if (typeof options.database !== "string" || options.database === "") {
    throw new Error("DashQ: 'database' is required and must be a non-empty string.");
  }

  if (options.port !== undefined) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
      throw new Error(
        `DashQ: 'port' must be an integer between 0 and 65535. Got: ${options.port}`,
      );
    }
  }

  if (options.host !== undefined && typeof options.host !== "string") {
    throw new Error("DashQ: 'host' must be a string.");
  }

  if (
    options.worker !== undefined &&
    typeof options.worker !== "boolean" &&
    typeof options.worker !== "object"
  ) {
    throw new Error("DashQ: 'worker' must be a boolean or WorkerOptions object.");
  }

  if (typeof options.worker === "object" && options.worker.concurrency !== undefined) {
    if (
      !Number.isInteger(options.worker.concurrency) ||
      options.worker.concurrency < 1
    ) {
      throw new Error(
        `DashQ: 'worker.concurrency' must be a positive integer (>= 1). Got: ${options.worker.concurrency}`,
      );
    }
  }

  if (
    options.dashboard !== undefined &&
    typeof options.dashboard !== "boolean" &&
    typeof options.dashboard !== "object"
  ) {
    throw new Error("DashQ: 'dashboard' must be a boolean or an options object.");
  }
}
