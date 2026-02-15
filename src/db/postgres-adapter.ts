/**
 * Postgres adapter for DashQ using the pg library.
 *
 * Factory function that returns a DatabaseAdapter backed by a pg connection
 * pool. The pg module is dynamically imported in initialize() so that
 * SQLite-only users don't need it installed.
 */

import type { Pool as PgPool } from "pg";
import type { DatabaseAdapter } from "./adapter.js";
import type {
  Job,
  NewJob,
  JobLog,
  NewJobLog,
  JobFilter,
  JobStatus,
  WorkerInfo,
} from "../types.js";
import { runMigrations } from "./schema.js";
import { generateId } from "./uuid.js";

// ---------------------------------------------------------------------------
// Allowlists for dynamic SQL (prevent SQL injection)
// ---------------------------------------------------------------------------

const VALID_SORT_COLUMNS = new Set(["created_at", "updated_at", "run_at"]);
const VALID_SORT_ORDERS = new Set(["asc", "desc"]);
const VALID_UPDATE_COLUMNS = new Set([
  "job_type",
  "args",
  "status",
  "attempts",
  "max_attempts",
  "run_at",
  "locked_until",
  "last_error",
]);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Postgres-backed DatabaseAdapter.
 *
 * @param connectionString Postgres connection string (e.g. "postgres://user:pass@host/db").
 */
export function createPostgresAdapter(connectionString: string): DatabaseAdapter {
  let pool: PgPool;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async function initialize(): Promise<void> {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString });

    const execute = async (sql: string) => {
      await pool.query(sql);
    };
    const queryRow = async (
      sql: string,
    ): Promise<Record<string, unknown> | null> => {
      const result = await pool.query(sql);
      return result.rows[0] ?? null;
    };

    await runMigrations(execute, queryRow, "postgres");
  }

  async function close(): Promise<void> {
    await pool.end();
  }

  // -----------------------------------------------------------------------
  // Jobs CRUD
  // -----------------------------------------------------------------------

  async function insertJob(job: NewJob): Promise<Job> {
    const id = generateId();
    const now = new Date().toISOString();
    const maxAttempts = job.max_attempts ?? 3;
    const runAt = job.run_at ?? now;

    const result = await pool.query(
      `INSERT INTO dashq_jobs (id, job_type, args, status, attempts, max_attempts, run_at, locked_until, last_error, created_at, updated_at)
       VALUES ($1, $2, $3, 'queued', 0, $4, $5, NULL, NULL, $6, $7)
       RETURNING *`,
      [id, job.job_type, job.args, maxAttempts, runAt, now, now],
    );
    return result.rows[0] as Job;
  }

  async function getJob(id: string): Promise<Job | null> {
    const result = await pool.query(
      `SELECT * FROM dashq_jobs WHERE id = $1`,
      [id],
    );
    return (result.rows[0] as Job) ?? null;
  }

  async function listJobs(
    filter: JobFilter,
  ): Promise<{ jobs: Job[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filter.status !== undefined) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    }
    if (filter.job_type !== undefined) {
      conditions.push(`job_type = $${paramIndex++}`);
      params.push(filter.job_type);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Validate sort parameters against allowlist
    const sortBy = filter.sort_by ?? "created_at";
    const sortOrder = filter.sort_order ?? "desc";
    if (!VALID_SORT_COLUMNS.has(sortBy)) {
      throw new Error(`Invalid sort_by column: ${sortBy}`);
    }
    if (!VALID_SORT_ORDERS.has(sortOrder)) {
      throw new Error(`Invalid sort_order: ${sortOrder}`);
    }

    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM dashq_jobs ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total as string, 10);

    const jobsResult = await pool.query(
      `SELECT * FROM dashq_jobs ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset],
    );

    return { jobs: jobsResult.rows as Job[], total };
  }

  async function updateJob(id: string, updates: Partial<Job>): Promise<Job> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === "id" || key === "updated_at") continue;
      if (!VALID_UPDATE_COLUMNS.has(key)) continue;
      setClauses.push(`${key} = $${paramIndex++}`);
      params.push(value);
    }

    // Always set updated_at
    const now = new Date().toISOString();
    setClauses.push(`updated_at = $${paramIndex++}`);
    params.push(now);

    params.push(id);

    const result = await pool.query(
      `UPDATE dashq_jobs SET ${setClauses.join(", ")} WHERE id = $${paramIndex++} RETURNING *`,
      params,
    );

    return result.rows[0] as Job;
  }

  async function deleteJob(id: string): Promise<void> {
    await pool.query(`DELETE FROM dashq_jobs WHERE id = $1`, [id]);
  }

  // -----------------------------------------------------------------------
  // Worker claiming
  // -----------------------------------------------------------------------

  async function claimNextJob(workerInfo: WorkerInfo): Promise<Job | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const lockedUntilIso = new Date(
      now.getTime() + workerInfo.lease_duration_ms,
    ).toISOString();

    const result = await pool.query(
      `UPDATE dashq_jobs
       SET status = 'running', locked_until = $1, attempts = attempts + 1, updated_at = $2
       WHERE id = (
         SELECT id FROM dashq_jobs
         WHERE status = 'queued' AND run_at <= $3
         ORDER BY run_at ASC LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [lockedUntilIso, nowIso, nowIso],
    );

    return (result.rows[0] as Job) ?? null;
  }

  async function markSucceeded(id: string): Promise<void> {
    await pool.query(
      `UPDATE dashq_jobs SET status = 'succeeded', locked_until = NULL, updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), id],
    );
  }

  async function markFailed(id: string, error: string): Promise<void> {
    await pool.query(
      `UPDATE dashq_jobs SET status = 'failed', locked_until = NULL, last_error = $1, updated_at = $2 WHERE id = $3`,
      [error, new Date().toISOString(), id],
    );
  }

  async function requeueJob(id: string): Promise<void> {
    await pool.query(
      `UPDATE dashq_jobs SET status = 'queued', locked_until = NULL, updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), id],
    );
  }

  async function recoverStaleJobs(): Promise<number> {
    const now = new Date().toISOString();
    const result = await pool.query(
      `UPDATE dashq_jobs SET status = 'queued', locked_until = NULL, updated_at = $1 WHERE status = 'running' AND locked_until < $2`,
      [now, now],
    );
    return result.rowCount ?? 0;
  }

  // -----------------------------------------------------------------------
  // Logs
  // -----------------------------------------------------------------------

  async function insertLog(log: NewJobLog): Promise<void> {
    const id = generateId();
    await pool.query(
      `INSERT INTO dashq_job_logs (id, job_id, attempt, level, message, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, log.job_id, log.attempt, log.level, log.message, log.timestamp],
    );
  }

  async function insertLogs(logs: NewJobLog[]): Promise<void> {
    if (logs.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const log of logs) {
      const id = generateId();
      values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      params.push(id, log.job_id, log.attempt, log.level, log.message, log.timestamp);
    }

    await pool.query(
      `INSERT INTO dashq_job_logs (id, job_id, attempt, level, message, timestamp) VALUES ${values.join(", ")}`,
      params,
    );
  }

  async function getJobLogs(jobId: string, attempt?: number): Promise<JobLog[]> {
    if (attempt !== undefined) {
      const result = await pool.query(
        `SELECT * FROM dashq_job_logs WHERE job_id = $1 AND attempt = $2 ORDER BY timestamp ASC`,
        [jobId, attempt],
      );
      return result.rows as JobLog[];
    }
    const result = await pool.query(
      `SELECT * FROM dashq_job_logs WHERE job_id = $1 ORDER BY timestamp ASC`,
      [jobId],
    );
    return result.rows as JobLog[];
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  async function getJobCounts(): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    };

    const result = await pool.query(
      `SELECT status, COUNT(*) as count FROM dashq_jobs GROUP BY status`,
    );
    for (const row of result.rows) {
      counts[row.status as JobStatus] = parseInt(row.count as string, 10);
    }

    return counts;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  async function deleteOldJobs(
    olderThan: Date,
    statuses: JobStatus[],
  ): Promise<number> {
    if (statuses.length === 0) return 0;

    let paramIndex = 2;
    const placeholders = statuses.map(() => `$${paramIndex++}`).join(", ");
    const result = await pool.query(
      `DELETE FROM dashq_jobs WHERE updated_at < $1 AND status IN (${placeholders})`,
      [olderThan.toISOString(), ...statuses],
    );

    return result.rowCount ?? 0;
  }

  async function deleteOldLogs(olderThan: Date): Promise<number> {
    const result = await pool.query(
      `DELETE FROM dashq_job_logs WHERE timestamp < $1`,
      [olderThan.toISOString()],
    );
    return result.rowCount ?? 0;
  }

  // -----------------------------------------------------------------------
  // Return adapter
  // -----------------------------------------------------------------------

  return {
    initialize,
    close,
    insertJob,
    getJob,
    listJobs,
    updateJob,
    deleteJob,
    claimNextJob,
    markSucceeded,
    markFailed,
    requeueJob,
    recoverStaleJobs,
    insertLog,
    insertLogs,
    getJobLogs,
    getJobCounts,
    deleteOldJobs,
    deleteOldLogs,
  };
}
