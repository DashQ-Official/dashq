import { describe, it, expect, afterEach } from "vitest";
import type { DatabaseAdapter } from "./adapter.js";
import { createAdapter } from "./create-adapter.js";

describe("createAdapter", () => {
  let adapter: DatabaseAdapter | undefined;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = undefined;
    }
  });

  it("returns a working SQLite adapter for type 'sqlite'", async () => {
    adapter = createAdapter({ type: "sqlite", path: ":memory:" });
    await adapter.initialize();

    const job = await adapter.insertJob({
      job_type: "test.job",
      args: JSON.stringify({ x: 1 }),
    });

    const fetched = await adapter.getJob(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.job_type).toBe("test.job");
  });

  it("returns a Postgres adapter for type 'postgres'", () => {
    const pg = createAdapter({
      type: "postgres",
      connectionString: "postgres://localhost/test",
    });

    // Verify the returned object has all DatabaseAdapter methods without
    // calling initialize() (no PG server required).
    const expectedMethods: (keyof DatabaseAdapter)[] = [
      "initialize",
      "close",
      "insertJob",
      "getJob",
      "listJobs",
      "updateJob",
      "deleteJob",
      "claimNextJob",
      "markSucceeded",
      "markFailed",
      "requeueJob",
      "recoverStaleJobs",
      "insertLog",
      "getJobLogs",
      "getJobCounts",
      "deleteOldJobs",
      "deleteOldLogs",
    ];

    for (const method of expectedMethods) {
      expect(typeof pg[method]).toBe("function");
    }
  });

  it("throws for an unknown database type", () => {
    expect(() =>
      createAdapter({ type: "mysql" } as any),
    ).toThrow("Unknown database type: mysql");
  });
});
