import { describe, it, expect, vi } from "vitest";
import {
  runMigrations,
  SCHEMA_VERSION,
  TABLE_JOBS,
  TABLE_JOB_LOGS,
  TABLE_META,
  CREATE_JOBS_TABLE,
  CREATE_JOBS_STATUS_RUN_AT_INDEX,
  CREATE_JOBS_JOB_TYPE_INDEX,
  CREATE_JOB_LOGS_TABLE,
  CREATE_JOB_LOGS_JOB_ID_INDEX,
  CREATE_META_TABLE,
} from "./schema.js";

describe("schema", () => {
  describe("DDL constants", () => {
    it("CREATE_JOBS_TABLE contains the table name and CREATE TABLE", () => {
      expect(CREATE_JOBS_TABLE).toContain(TABLE_JOBS);
      expect(CREATE_JOBS_TABLE).toContain("CREATE TABLE");
    });

    it("CREATE_JOB_LOGS_TABLE contains the table name and foreign key", () => {
      expect(CREATE_JOB_LOGS_TABLE).toContain(TABLE_JOB_LOGS);
      expect(CREATE_JOB_LOGS_TABLE).toContain("FOREIGN KEY");
    });

    it("CREATE_META_TABLE contains the table name", () => {
      expect(CREATE_META_TABLE).toContain(TABLE_META);
    });

    it("indexes reference the correct tables", () => {
      expect(CREATE_JOBS_STATUS_RUN_AT_INDEX).toContain(TABLE_JOBS);
      expect(CREATE_JOBS_JOB_TYPE_INDEX).toContain(TABLE_JOBS);
      expect(CREATE_JOB_LOGS_JOB_ID_INDEX).toContain(TABLE_JOB_LOGS);
    });

    it("all DDL uses IF NOT EXISTS", () => {
      const allDdl = [
        CREATE_JOBS_TABLE,
        CREATE_JOBS_STATUS_RUN_AT_INDEX,
        CREATE_JOBS_JOB_TYPE_INDEX,
        CREATE_JOB_LOGS_TABLE,
        CREATE_JOB_LOGS_JOB_ID_INDEX,
        CREATE_META_TABLE,
      ];
      for (const ddl of allDdl) {
        expect(ddl).toContain("IF NOT EXISTS");
      }
    });
  });

  describe("SCHEMA_VERSION", () => {
    it("is a positive integer", () => {
      expect(SCHEMA_VERSION).toBeGreaterThan(0);
      expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    });
  });

  describe("runMigrations", () => {
    it("applies all migrations on a fresh database", async () => {
      const executed: string[] = [];
      let storedVersion: string | null = null;

      const execute = vi.fn(async (sql: string) => {
        executed.push(sql);
        // Track version writes
        const insertMatch = sql.match(
          /INSERT INTO dashq_meta .* VALUES \('schema_version', '(\d+)'\)/,
        );
        if (insertMatch) {
          storedVersion = insertMatch[1];
        }
        const updateMatch = sql.match(
          /UPDATE dashq_meta SET value = '(\d+)'/,
        );
        if (updateMatch) {
          storedVersion = updateMatch[1];
        }
      });

      const queryRow = vi.fn(async (sql: string) => {
        if (sql.includes("schema_version")) {
          return storedVersion ? { value: storedVersion } : null;
        }
        return null;
      });

      const version = await runMigrations(execute, queryRow, "sqlite");

      expect(version).toBe(SCHEMA_VERSION);

      // Should have created meta table
      expect(executed.some((s) => s.includes(TABLE_META))).toBe(true);

      // Should have created jobs and job_logs tables
      expect(executed.some((s) => s.includes(TABLE_JOBS))).toBe(true);
      expect(executed.some((s) => s.includes(TABLE_JOB_LOGS))).toBe(true);

      // Should have inserted version
      expect(
        executed.some((s) => s.includes("INSERT INTO dashq_meta")),
      ).toBe(true);
    });

    it("skips migrations when already at current version", async () => {
      const executed: string[] = [];

      const execute = vi.fn(async (sql: string) => {
        executed.push(sql);
      });

      const queryRow = vi.fn(async (sql: string) => {
        if (sql.includes("schema_version")) {
          return { value: String(SCHEMA_VERSION) };
        }
        return null;
      });

      const version = await runMigrations(execute, queryRow, "sqlite");

      expect(version).toBe(SCHEMA_VERSION);

      // Should only run CREATE_META_TABLE (bootstrap), no migration DDL
      const jobsDdl = executed.filter(
        (s) => s.includes(TABLE_JOBS) || s.includes(TABLE_JOB_LOGS),
      );
      expect(jobsDdl).toHaveLength(0);
    });

    it("returns the final schema version", async () => {
      let storedVersion: string | null = null;

      const execute = vi.fn(async (sql: string) => {
        const insertMatch = sql.match(
          /INSERT INTO dashq_meta .* VALUES \('schema_version', '(\d+)'\)/,
        );
        if (insertMatch) storedVersion = insertMatch[1];
        const updateMatch = sql.match(
          /UPDATE dashq_meta SET value = '(\d+)'/,
        );
        if (updateMatch) storedVersion = updateMatch[1];
      });

      const queryRow = vi.fn(async (sql: string) => {
        if (sql.includes("schema_version")) {
          return storedVersion ? { value: storedVersion } : null;
        }
        return null;
      });

      const result = await runMigrations(execute, queryRow, "postgres");
      expect(result).toBe(SCHEMA_VERSION);
    });

    it("is idempotent — second run produces no migration DDL", async () => {
      let storedVersion: string | null = null;

      const execute = vi.fn(async (sql: string) => {
        const insertMatch = sql.match(
          /INSERT INTO dashq_meta .* VALUES \('schema_version', '(\d+)'\)/,
        );
        if (insertMatch) storedVersion = insertMatch[1];
        const updateMatch = sql.match(
          /UPDATE dashq_meta SET value = '(\d+)'/,
        );
        if (updateMatch) storedVersion = updateMatch[1];
      });

      const queryRow = vi.fn(async (sql: string) => {
        if (sql.includes("schema_version")) {
          return storedVersion ? { value: storedVersion } : null;
        }
        return null;
      });

      // First run — applies migrations
      await runMigrations(execute, queryRow, "sqlite");
      expect(storedVersion).toBe(String(SCHEMA_VERSION));

      // Reset call tracking
      execute.mockClear();

      // Second run — should only bootstrap meta table
      await runMigrations(execute, queryRow, "sqlite");

      const secondRunDdl = execute.mock.calls
        .map((c) => c[0] as string)
        .filter((s) => s.includes(TABLE_JOBS) || s.includes(TABLE_JOB_LOGS));

      expect(secondRunDdl).toHaveLength(0);
    });
  });
});
