/**
 * SQLite adapter for DashQ using better-sqlite3.
 *
 * Factory function that returns a DatabaseAdapter backed by a single
 * better-sqlite3 connection. All operations are synchronous under the
 * hood but wrapped in Promises to satisfy the async adapter interface.
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
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
 * Creates a SQLite-backed DatabaseAdapter.
 *
 * @param path File path for the SQLite database, or `:memory:` for in-memory.
 */
export function createSqliteAdapter(path: string): DatabaseAdapter {
  let db: BetterSqlite3.Database;

  // Prepared statements — populated in initialize()
  let stmts: {
    insertJob: BetterSqlite3.Statement;
    getJob: BetterSqlite3.Statement;
    deleteJob: BetterSqlite3.Statement;
    claimFind: BetterSqlite3.Statement;
    claimUpdate: BetterSqlite3.Statement;
    markSucceeded: BetterSqlite3.Statement;
    markFailed: BetterSqlite3.Statement;
    requeueJob: BetterSqlite3.Statement;
    recoverStaleJobs: BetterSqlite3.Statement;
    insertLog: BetterSqlite3.Statement;
    getLogsByJob: BetterSqlite3.Statement;
    getLogsByJobAttempt: BetterSqlite3.Statement;
    getJobCounts: BetterSqlite3.Statement;
    deleteOldLogs: BetterSqlite3.Statement;
  };

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async function initialize(): Promise<void> {
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const execute = async (sql: string) => {
      db.exec(sql);
    };
    const queryRow = async (
      sql: string,
    ): Promise<Record<string, unknown> | null> => {
      const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
      return row ?? null;
    };

    await runMigrations(execute, queryRow, "sqlite");

    stmts = {
      insertJob: db.prepare(
        `INSERT INTO dashq_jobs (id, job_type, args, status, attempts, max_attempts, run_at, locked_until, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', 0, ?, ?, NULL, NULL, ?, ?)`,
      ),
      getJob: db.prepare(`SELECT * FROM dashq_jobs WHERE id = ?`),
      deleteJob: db.prepare(`DELETE FROM dashq_jobs WHERE id = ?`),
      claimFind: db.prepare(
        `SELECT id FROM dashq_jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at ASC LIMIT 1`,
      ),
      claimUpdate: db.prepare(
        `UPDATE dashq_jobs SET status = 'running', locked_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`,
      ),
      markSucceeded: db.prepare(
        `UPDATE dashq_jobs SET status = 'succeeded', locked_until = NULL, updated_at = ? WHERE id = ?`,
      ),
      markFailed: db.prepare(
        `UPDATE dashq_jobs SET status = 'failed', locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
      ),
      requeueJob: db.prepare(
        `UPDATE dashq_jobs SET status = 'queued', locked_until = NULL, updated_at = ? WHERE id = ?`,
      ),
      recoverStaleJobs: db.prepare(
        `UPDATE dashq_jobs SET status = 'queued', locked_until = NULL, updated_at = ? WHERE status = 'running' AND locked_until < ?`,
      ),
      insertLog: db.prepare(
        `INSERT INTO dashq_job_logs (id, job_id, attempt, level, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      getLogsByJob: db.prepare(
        `SELECT * FROM dashq_job_logs WHERE job_id = ? ORDER BY timestamp ASC`,
      ),
      getLogsByJobAttempt: db.prepare(
        `SELECT * FROM dashq_job_logs WHERE job_id = ? AND attempt = ? ORDER BY timestamp ASC`,
      ),
      getJobCounts: db.prepare(
        `SELECT status, COUNT(*) as count FROM dashq_jobs GROUP BY status`,
      ),
      deleteOldLogs: db.prepare(
        `DELETE FROM dashq_job_logs WHERE timestamp < ?`,
      ),
    };
  }

  async function close(): Promise<void> {
    db.close();
  }

  // -----------------------------------------------------------------------
  // Jobs CRUD
  // -----------------------------------------------------------------------

  async function insertJob(job: NewJob): Promise<Job> {
    const id = generateId();
    const now = new Date().toISOString();
    const maxAttempts = job.max_attempts ?? 3;
    const runAt = job.run_at ?? now;

    stmts.insertJob.run(id, job.job_type, job.args, maxAttempts, runAt, now, now);
    return stmts.getJob.get(id) as Job;
  }

  async function getJob(id: string): Promise<Job | null> {
    const row = stmts.getJob.get(id) as Job | undefined;
    return row ?? null;
  }

  async function listJobs(
    filter: JobFilter,
  ): Promise<{ jobs: Job[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.status !== undefined) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter.job_type !== undefined) {
      conditions.push("job_type = ?");
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

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM dashq_jobs ${whereClause}`)
      .get(...params) as { total: number };

    const jobs = db
      .prepare(
        `SELECT * FROM dashq_jobs ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Job[];

    return { jobs, total: countRow.total };
  }

  async function updateJob(id: string, updates: Partial<Job>): Promise<Job> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === "id" || key === "updated_at") continue;
      if (!VALID_UPDATE_COLUMNS.has(key)) continue;
      setClauses.push(`${key} = ?`);
      params.push(value);
    }

    // Always set updated_at
    setClauses.push("updated_at = ?");
    const now = new Date().toISOString();
    params.push(now);

    params.push(id);

    db.prepare(
      `UPDATE dashq_jobs SET ${setClauses.join(", ")} WHERE id = ?`,
    ).run(...params);

    return stmts.getJob.get(id) as Job;
  }

  async function deleteJob(id: string): Promise<void> {
    stmts.deleteJob.run(id);
  }

  // -----------------------------------------------------------------------
  // Worker claiming
  // -----------------------------------------------------------------------

  async function claimNextJob(workerInfo: WorkerInfo): Promise<Job | null> {
    const claim = db.transaction(() => {
      const now = new Date();
      const nowIso = now.toISOString();
      const lockedUntilIso = new Date(
        now.getTime() + workerInfo.lease_duration_ms,
      ).toISOString();

      const candidate = stmts.claimFind.get(nowIso) as
        | { id: string }
        | undefined;
      if (!candidate) return null;

      const result = stmts.claimUpdate.run(
        lockedUntilIso,
        nowIso,
        candidate.id,
      );
      if (result.changes === 0) return null;

      return stmts.getJob.get(candidate.id) as Job;
    });

    return claim();
  }

  async function markSucceeded(id: string): Promise<void> {
    stmts.markSucceeded.run(new Date().toISOString(), id);
  }

  async function markFailed(id: string, error: string): Promise<void> {
    stmts.markFailed.run(error, new Date().toISOString(), id);
  }

  async function requeueJob(id: string): Promise<void> {
    stmts.requeueJob.run(new Date().toISOString(), id);
  }

  async function recoverStaleJobs(): Promise<number> {
    const now = new Date().toISOString();
    const result = stmts.recoverStaleJobs.run(now, now);
    return result.changes;
  }

  // -----------------------------------------------------------------------
  // Logs
  // -----------------------------------------------------------------------

  async function insertLog(log: NewJobLog): Promise<void> {
    const id = generateId();
    stmts.insertLog.run(id, log.job_id, log.attempt, log.level, log.message, log.timestamp);
  }

  async function insertLogs(logs: NewJobLog[]): Promise<void> {
    if (logs.length === 0) return;

    const insertMany = db.transaction((entries: NewJobLog[]) => {
      for (const log of entries) {
        const id = generateId();
        stmts.insertLog.run(id, log.job_id, log.attempt, log.level, log.message, log.timestamp);
      }
    });

    insertMany(logs);
  }

  async function getJobLogs(jobId: string, attempt?: number): Promise<JobLog[]> {
    if (attempt !== undefined) {
      return stmts.getLogsByJobAttempt.all(jobId, attempt) as JobLog[];
    }
    return stmts.getLogsByJob.all(jobId) as JobLog[];
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

    const rows = stmts.getJobCounts.all() as {
      status: JobStatus;
      count: number;
    }[];
    for (const row of rows) {
      counts[row.status] = row.count;
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

    const placeholders = statuses.map(() => "?").join(", ");
    const result = db
      .prepare(
        `DELETE FROM dashq_jobs WHERE updated_at < ? AND status IN (${placeholders})`,
      )
      .run(olderThan.toISOString(), ...statuses);

    return result.changes;
  }

  async function deleteOldLogs(olderThan: Date): Promise<number> {
    const result = stmts.deleteOldLogs.run(olderThan.toISOString());
    return result.changes;
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
