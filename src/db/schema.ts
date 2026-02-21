/**
 * Schema DDL constants and migration logic for DashQ.
 *
 * This module contains all table definitions, index definitions, and
 * versioned migration steps. Both the SQLite and Postgres adapters
 * import from here to initialize their databases.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported database dialects. */
export type SchemaDialect = "sqlite" | "postgres";

/** Executes a single SQL statement. Provided by each adapter. */
export type SqlExecutor = (sql: string) => Promise<void>;

/** Executes a SQL query and returns a single row, or null. */
export type SqlQueryRow = (
  sql: string,
) => Promise<Record<string, unknown> | null>;

// ---------------------------------------------------------------------------
// Table Names
// ---------------------------------------------------------------------------

export const TABLE_JOBS = "dashq_jobs";
export const TABLE_JOB_LOGS = "dashq_job_logs";
export const TABLE_META = "dashq_meta";
export const TABLE_WORKERS = "dashq_workers";

// ---------------------------------------------------------------------------
// Schema Version
// ---------------------------------------------------------------------------

/** The latest schema version. Increment when adding new migrations. */
export const SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Version 1 — Initial Schema
// ---------------------------------------------------------------------------

export const CREATE_JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS ${TABLE_JOBS} (
  id              TEXT PRIMARY KEY,
  job_type        TEXT NOT NULL,
  args            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  run_at          TEXT NOT NULL,
  locked_until    TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);`;

export const CREATE_JOBS_STATUS_RUN_AT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_dashq_jobs_status_run_at
  ON ${TABLE_JOBS} (status, run_at);`;

export const CREATE_JOBS_JOB_TYPE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_dashq_jobs_job_type
  ON ${TABLE_JOBS} (job_type);`;

export const CREATE_JOB_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS ${TABLE_JOB_LOGS} (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL,
  attempt         INTEGER NOT NULL,
  level           TEXT NOT NULL,
  message         TEXT NOT NULL,
  timestamp       TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES ${TABLE_JOBS}(id) ON DELETE CASCADE
);`;

export const CREATE_JOB_LOGS_JOB_ID_INDEX = `
CREATE INDEX IF NOT EXISTS idx_dashq_job_logs_job_id
  ON ${TABLE_JOB_LOGS} (job_id, attempt);`;

export const CREATE_META_TABLE = `
CREATE TABLE IF NOT EXISTS ${TABLE_META} (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);`;

// ---------------------------------------------------------------------------
// Version 2 — Workers
// ---------------------------------------------------------------------------

export const CREATE_WORKERS_TABLE = `
CREATE TABLE IF NOT EXISTS ${TABLE_WORKERS} (
  id              TEXT PRIMARY KEY,
  hostname        TEXT NOT NULL,
  pid             INTEGER NOT NULL,
  concurrency     INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  started_at      TEXT NOT NULL,
  last_heartbeat  TEXT NOT NULL,
  stopped_at      TEXT
);`;

export const CREATE_WORKERS_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_dashq_workers_status
  ON ${TABLE_WORKERS} (status);`;

// ---------------------------------------------------------------------------
// Migration Steps
// ---------------------------------------------------------------------------

type MigrationStep = {
  /** The version this step migrates TO. */
  version: number;
  /** SQL statements to execute, in order. */
  statements: string[];
};

/**
 * All migration steps in ascending version order.
 * Each step's statements are executed sequentially.
 * Future schema changes append new entries here.
 */
const MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 1,
    statements: [
      CREATE_JOBS_TABLE,
      CREATE_JOBS_STATUS_RUN_AT_INDEX,
      CREATE_JOBS_JOB_TYPE_INDEX,
      CREATE_JOB_LOGS_TABLE,
      CREATE_JOB_LOGS_JOB_ID_INDEX,
    ],
  },
  {
    version: 2,
    statements: [
      CREATE_WORKERS_TABLE,
      CREATE_WORKERS_STATUS_INDEX,
      `ALTER TABLE ${TABLE_JOBS} ADD COLUMN worker_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_dashq_jobs_worker_id ON ${TABLE_JOBS} (worker_id)`,
    ],
  },
];

// ---------------------------------------------------------------------------
// Version Helpers (internal)
// ---------------------------------------------------------------------------

const META_KEY_SCHEMA_VERSION = "schema_version";

/**
 * Reads the current schema version from dashq_meta.
 * Returns 0 if no version row exists (fresh database).
 */
async function getSchemaVersion(queryRow: SqlQueryRow): Promise<number> {
  const row = await queryRow(
    `SELECT value FROM ${TABLE_META} WHERE key = '${META_KEY_SCHEMA_VERSION}'`,
  );
  if (row === null) {
    return 0;
  }
  return parseInt(row.value as string, 10);
}

/**
 * Writes the schema version to dashq_meta (insert or update).
 * Uses check-then-write to avoid dialect-specific upsert syntax.
 */
async function setSchemaVersion(
  execute: SqlExecutor,
  queryRow: SqlQueryRow,
  version: number,
): Promise<void> {
  const existing = await queryRow(
    `SELECT value FROM ${TABLE_META} WHERE key = '${META_KEY_SCHEMA_VERSION}'`,
  );
  if (existing === null) {
    await execute(
      `INSERT INTO ${TABLE_META} (key, value) VALUES ('${META_KEY_SCHEMA_VERSION}', '${version}')`,
    );
  } else {
    await execute(
      `UPDATE ${TABLE_META} SET value = '${version}' WHERE key = '${META_KEY_SCHEMA_VERSION}'`,
    );
  }
}

// ---------------------------------------------------------------------------
// Migration Runner
// ---------------------------------------------------------------------------

/**
 * Runs all pending schema migrations.
 *
 * Call this from a DatabaseAdapter's `initialize()` method, passing in
 * executor functions that bridge to the adapter's database connection.
 *
 * @param execute  Runs a single SQL statement (no return value needed).
 * @param queryRow Runs a SQL query and returns the first row, or null.
 * @param _dialect The database dialect (reserved for future dialect-specific DDL).
 * @returns The schema version after all migrations have been applied.
 */
export async function runMigrations(
  execute: SqlExecutor,
  queryRow: SqlQueryRow,
  _dialect: SchemaDialect,
): Promise<number> {
  // 1. Ensure the meta table exists (bootstrap — always safe to run)
  await execute(CREATE_META_TABLE);

  // 2. Read the current schema version
  const currentVersion = await getSchemaVersion(queryRow);

  // 3. Apply pending migrations in order
  for (const step of MIGRATIONS) {
    if (step.version > currentVersion) {
      for (const sql of step.statements) {
        await execute(sql);
      }
      await setSchemaVersion(execute, queryRow, step.version);
    }
  }

  // 4. Return the final version
  return getSchemaVersion(queryRow);
}
