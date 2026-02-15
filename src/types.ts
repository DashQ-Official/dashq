/**
 * Shared TypeScript types for DashQ.
 *
 * These types represent the core domain model: jobs, logs, and the
 * supporting types used by the DatabaseAdapter interface.
 */

// ---------------------------------------------------------------------------
// Union Types
// ---------------------------------------------------------------------------

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type LogLevel = "info" | "warn" | "error";

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

/** A job row as stored in the `dashq_jobs` table. */
export type Job = {
  /** UUIDv7 primary key. */
  id: string;
  /** Dotted job type identifier, e.g. "email.send". */
  job_type: string;
  /** JSON-serialized arguments string. */
  args: string;
  /** Current lifecycle status. */
  status: JobStatus;
  /** Number of execution attempts so far. */
  attempts: number;
  /** Maximum allowed attempts before marking as failed. */
  max_attempts: number;
  /** ISO 8601 timestamp — when the job is eligible to run. */
  run_at: string;
  /** ISO 8601 timestamp — worker lease expiry. Null when not locked. */
  locked_until: string | null;
  /** Most recent error message/stack trace. Null if no error. */
  last_error: string | null;
  /** ISO 8601 timestamp — when the job was created. */
  created_at: string;
  /** ISO 8601 timestamp — when the job was last updated. */
  updated_at: string;
};

// ---------------------------------------------------------------------------
// NewJob
// ---------------------------------------------------------------------------

/**
 * Input type for creating a new job.
 *
 * Only `job_type` and `args` are required. Other fields have defaults:
 * - `max_attempts` defaults to 3
 * - `run_at` defaults to now
 */
export type NewJob = {
  /** Dotted job type identifier, e.g. "email.send". */
  job_type: string;
  /** JSON-serialized arguments string. */
  args: string;
  /** Maximum allowed attempts. Defaults to 3. */
  max_attempts?: number;
  /** ISO 8601 timestamp — when the job should run. Defaults to now. */
  run_at?: string;
};

// ---------------------------------------------------------------------------
// JobLog
// ---------------------------------------------------------------------------

/** A log entry row as stored in the `dashq_job_logs` table. */
export type JobLog = {
  /** UUIDv7 primary key. */
  id: string;
  /** The job this log entry belongs to. */
  job_id: string;
  /** Which execution attempt produced this log entry. */
  attempt: number;
  /** Log severity level. */
  level: LogLevel;
  /** Log message content. */
  message: string;
  /** ISO 8601 timestamp of when the log was captured. */
  timestamp: string;
};

// ---------------------------------------------------------------------------
// NewJobLog
// ---------------------------------------------------------------------------

/** Input type for inserting a log entry. Omits auto-generated `id`. */
export type NewJobLog = {
  /** The job this log entry belongs to. */
  job_id: string;
  /** Which execution attempt produced this log entry. */
  attempt: number;
  /** Log severity level. */
  level: LogLevel;
  /** Log message content. */
  message: string;
  /** ISO 8601 timestamp of when the log was captured. */
  timestamp: string;
};

// ---------------------------------------------------------------------------
// JobFilter
// ---------------------------------------------------------------------------

/** Filter and pagination parameters for listing jobs. All fields optional. */
export type JobFilter = {
  /** Filter by job status. */
  status?: JobStatus;
  /** Filter by job type (exact match). */
  job_type?: string;
  /** Number of rows to skip. Defaults to 0. */
  offset?: number;
  /** Maximum number of rows to return. Defaults to 50. */
  limit?: number;
  /** Column to sort by. Defaults to "created_at". */
  sort_by?: "created_at" | "updated_at" | "run_at";
  /** Sort direction. Defaults to "desc". */
  sort_order?: "asc" | "desc";
};

// ---------------------------------------------------------------------------
// WorkerInfo
// ---------------------------------------------------------------------------

/** Information about the worker claiming a job. */
export type WorkerInfo = {
  /** Unique identifier for this worker instance. */
  worker_id: string;
  /** How long the job lease should last, in milliseconds. */
  lease_duration_ms: number;
};

// ---------------------------------------------------------------------------
// Job Definition & Registry
// ---------------------------------------------------------------------------

/** Strategy for computing retry backoff delays. */
export type BackoffStrategy =
  | "exponential"
  | "linear"
  | "fixed"
  | ((attempt: number) => number);

/** Options that can be provided when defining a job. */
export type JobOptions = {
  /** Maximum number of attempts before giving up. Defaults to 3. */
  maxAttempts?: number;
  /** Backoff strategy for retries. Defaults to "exponential". */
  backoff?: BackoffStrategy;
};

/** A fully-resolved job registration entry stored in the registry. */
export type RegisteredJob = {
  /** The unique job type identifier. */
  jobId: string;
  /** The async handler function invoked when the job runs. */
  handler: (...args: any[]) => Promise<void>;
  /** Resolved options with defaults applied. */
  options: Required<JobOptions>;
};

/** The object returned by `defineJob()`. Provides type-safe enqueue methods. */
export type JobDefinition<TArgs extends any[]> = {
  readonly jobId: string;
  enqueue(...args: TArgs): Promise<string>;
  enqueueAt(date: Date, ...args: TArgs): Promise<string>;
  enqueueIn(delay: string | number, ...args: TArgs): Promise<string>;
};

// ---------------------------------------------------------------------------
// Worker Options
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Retention & Cleanup
// ---------------------------------------------------------------------------

/** Configurable retention periods and cleanup behaviour. */
export type RetentionOptions = {
  /** How long to keep succeeded jobs. Default: "7d". */
  succeededJobRetention?: string | number;
  /** How long to keep failed jobs. Default: "14d". */
  failedJobRetention?: string | number;
  /** How long to keep log entries. Default: "14d". */
  logRetention?: string | number;
  /** Interval between automatic cleanup runs. Default: "1h". */
  cleanupInterval?: string | number;
  /** Max rows deleted per batch. Default: 1000. */
  cleanupBatchSize?: number;
};

/** Result of a single cleanup run. */
export type CleanupResult = {
  jobsDeleted: number;
  logsDeleted: number;
};

// ---------------------------------------------------------------------------
// Worker Options
// ---------------------------------------------------------------------------

/** Configuration options for the worker engine. */
export type WorkerOptions = {
  /** Base poll interval in ms. Defaults to 1000. */
  pollingInterval?: number;
  /** Maximum backoff interval in ms. Defaults to 30000. */
  maxPollingInterval?: number;
  /** Backoff multiplier when queue is empty. Defaults to 1.5. */
  backoffMultiplier?: number;
  /** Job lease duration in ms. Defaults to 300000 (5 min). */
  leaseTimeout?: number;
  /** Stale job check interval in ms. Defaults to 30000. */
  staleCheckInterval?: number;
  /** Max wait for current job on shutdown in ms. Defaults to 30000. */
  shutdownTimeout?: number;
};
