/**
 * DatabaseAdapter interface and configuration types.
 *
 * This is the abstraction layer between DashQ and the underlying database.
 * Concrete implementations exist for SQLite (better-sqlite3) and Postgres (pg).
 */

import type {
  Job,
  NewJob,
  JobLog,
  NewJobLog,
  JobFilter,
  WorkerInfo,
  JobStatus,
} from "../types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Database connection configuration (discriminated union). */
export type DatabaseConfig =
  | { type: "sqlite"; path: string }
  | { type: "postgres"; connectionString: string };

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

/** All database operations required by DashQ. */
export type DatabaseAdapter = {
  // -- Lifecycle --------------------------------------------------------------

  /** Create tables and run migrations. */
  initialize(): Promise<void>;

  /** Close database connections. */
  close(): Promise<void>;

  // -- Jobs CRUD --------------------------------------------------------------

  /** Insert a new job and return the full row. */
  insertJob(job: NewJob): Promise<Job>;

  /** Fetch a single job by ID, or null if not found. */
  getJob(id: string): Promise<Job | null>;

  /** List jobs matching a filter with total count for pagination. */
  listJobs(filter: JobFilter): Promise<{ jobs: Job[]; total: number }>;

  /** Partially update a job and return the full updated row. */
  updateJob(id: string, updates: Partial<Job>): Promise<Job>;

  /** Delete a job by ID. */
  deleteJob(id: string): Promise<void>;

  // -- Worker claiming --------------------------------------------------------

  /** Atomically claim the next eligible job for a worker. */
  claimNextJob(workerInfo: WorkerInfo): Promise<Job | null>;

  /** Mark a running job as succeeded. */
  markSucceeded(id: string): Promise<void>;

  /** Mark a running job as failed with an error message. */
  markFailed(id: string, error: string): Promise<void>;

  /** Reset a job back to queued status. */
  requeueJob(id: string): Promise<void>;

  /** Recover jobs with expired leases (crashed workers). Returns count recovered. */
  recoverStaleJobs(): Promise<number>;

  // -- Logs -------------------------------------------------------------------

  /** Insert a single log entry. */
  insertLog(log: NewJobLog): Promise<void>;

  /** Insert multiple log entries in a single batch. No-op for empty array. */
  insertLogs(logs: NewJobLog[]): Promise<void>;

  /** Get logs for a job, optionally filtered by attempt number. */
  getJobLogs(jobId: string, attempt?: number): Promise<JobLog[]>;

  // -- Stats ------------------------------------------------------------------

  /** Get job counts grouped by status. */
  getJobCounts(): Promise<Record<JobStatus, number>>;

  // -- Cleanup ----------------------------------------------------------------

  /** Delete jobs older than a date in the given statuses. Returns count deleted. */
  deleteOldJobs(olderThan: Date, statuses: JobStatus[]): Promise<number>;

  /** Delete log entries older than a date. Returns count deleted. */
  deleteOldLogs(olderThan: Date): Promise<number>;
};
