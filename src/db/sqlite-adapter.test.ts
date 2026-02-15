import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteAdapter } from "./sqlite-adapter.js";
import type { DatabaseAdapter } from "./adapter.js";
import type { NewJob } from "../types.js";

function createJob(overrides?: Partial<NewJob>): NewJob {
  return { job_type: "test.job", args: '{"key":"value"}', ...overrides };
}

const workerInfo = { worker_id: "w-1", lease_duration_ms: 30_000 };

describe("createSqliteAdapter", () => {
  let adapter: DatabaseAdapter;

  beforeEach(async () => {
    adapter = createSqliteAdapter(":memory:");
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe("initialize / close", () => {
    it("creates tables successfully (insertJob doesn't throw)", async () => {
      const job = await adapter.insertJob(createJob());
      expect(job).toBeDefined();
    });

    it("is idempotent (calling initialize twice doesn't error)", async () => {
      await expect(adapter.initialize()).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // insertJob
  // -----------------------------------------------------------------------

  describe("insertJob", () => {
    it("returns a full Job with generated UUIDv7 id", async () => {
      const job = await adapter.insertJob(createJob());
      expect(job.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("sets status to 'queued', attempts to 0", async () => {
      const job = await adapter.insertJob(createJob());
      expect(job.status).toBe("queued");
      expect(job.attempts).toBe(0);
    });

    it("defaults max_attempts to 3", async () => {
      const job = await adapter.insertJob(createJob());
      expect(job.max_attempts).toBe(3);
    });

    it("defaults run_at to approximately now", async () => {
      const before = new Date().toISOString();
      const job = await adapter.insertJob(createJob());
      const after = new Date().toISOString();
      expect(job.run_at >= before).toBe(true);
      expect(job.run_at <= after).toBe(true);
    });

    it("respects custom max_attempts", async () => {
      const job = await adapter.insertJob(createJob({ max_attempts: 5 }));
      expect(job.max_attempts).toBe(5);
    });

    it("respects custom run_at", async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const job = await adapter.insertJob(createJob({ run_at: future }));
      expect(job.run_at).toBe(future);
    });
  });

  // -----------------------------------------------------------------------
  // getJob
  // -----------------------------------------------------------------------

  describe("getJob", () => {
    it("returns the inserted job by id", async () => {
      const inserted = await adapter.insertJob(createJob());
      const fetched = await adapter.getJob(inserted.id);
      expect(fetched).toEqual(inserted);
    });

    it("returns null for non-existent id", async () => {
      const fetched = await adapter.getJob("00000000-0000-7000-8000-000000000000");
      expect(fetched).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // listJobs
  // -----------------------------------------------------------------------

  describe("listJobs", () => {
    it("returns empty list for empty database", async () => {
      const result = await adapter.listJobs({});
      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("returns all jobs with no filters", async () => {
      await adapter.insertJob(createJob());
      await adapter.insertJob(createJob({ job_type: "other.job" }));
      const result = await adapter.listJobs({});
      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertJob(createJob());
      await adapter.markSucceeded(job.id);

      const result = await adapter.listJobs({ status: "succeeded" });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe(job.id);
    });

    it("filters by job_type", async () => {
      await adapter.insertJob(createJob({ job_type: "email.send" }));
      await adapter.insertJob(createJob({ job_type: "report.generate" }));

      const result = await adapter.listJobs({ job_type: "email.send" });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].job_type).toBe("email.send");
    });

    it("combines status + job_type filters", async () => {
      const j1 = await adapter.insertJob(createJob({ job_type: "email.send" }));
      await adapter.insertJob(createJob({ job_type: "email.send" }));
      await adapter.insertJob(createJob({ job_type: "report.generate" }));
      await adapter.markSucceeded(j1.id);

      const result = await adapter.listJobs({
        status: "succeeded",
        job_type: "email.send",
      });
      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("returns correct total count with filters", async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.insertJob(createJob({ job_type: "batch.job" }));
      }
      await adapter.insertJob(createJob({ job_type: "other.job" }));

      const result = await adapter.listJobs({
        job_type: "batch.job",
        limit: 2,
      });
      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(5);
    });

    it("paginates with limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.insertJob(createJob());
      }

      const page1 = await adapter.listJobs({ limit: 2, offset: 0 });
      const page2 = await adapter.listJobs({ limit: 2, offset: 2 });
      const page3 = await adapter.listJobs({ limit: 2, offset: 4 });

      expect(page1.jobs).toHaveLength(2);
      expect(page2.jobs).toHaveLength(2);
      expect(page3.jobs).toHaveLength(1);

      const allIds = [
        ...page1.jobs.map((j) => j.id),
        ...page2.jobs.map((j) => j.id),
        ...page3.jobs.map((j) => j.id),
      ];
      expect(new Set(allIds).size).toBe(5);
    });

    it("sorts by created_at desc by default", async () => {
      const j1 = await adapter.insertJob(createJob());
      // Ensure distinct created_at timestamps
      await new Promise((r) => setTimeout(r, 10));
      const j2 = await adapter.insertJob(createJob());

      const result = await adapter.listJobs({});
      // desc: newest first
      expect(result.jobs[0].id).toBe(j2.id);
      expect(result.jobs[1].id).toBe(j1.id);
    });

    it("sorts by run_at asc when specified", async () => {
      const later = new Date(Date.now() + 60_000).toISOString();
      const sooner = new Date(Date.now() + 1_000).toISOString();

      const j1 = await adapter.insertJob(createJob({ run_at: later }));
      const j2 = await adapter.insertJob(createJob({ run_at: sooner }));

      const result = await adapter.listJobs({
        sort_by: "run_at",
        sort_order: "asc",
      });
      expect(result.jobs[0].id).toBe(j2.id);
      expect(result.jobs[1].id).toBe(j1.id);
    });

    it("throws on invalid sort_by", async () => {
      await expect(
        adapter.listJobs({ sort_by: "invalid" as any }),
      ).rejects.toThrow("Invalid sort_by");
    });

    it("throws on invalid sort_order", async () => {
      await expect(
        adapter.listJobs({ sort_order: "invalid" as any }),
      ).rejects.toThrow("Invalid sort_order");
    });
  });

  // -----------------------------------------------------------------------
  // updateJob
  // -----------------------------------------------------------------------

  describe("updateJob", () => {
    it("updates status field", async () => {
      const job = await adapter.insertJob(createJob());
      const updated = await adapter.updateJob(job.id, { status: "failed" });
      expect(updated.status).toBe("failed");
    });

    it("updates multiple fields at once", async () => {
      const job = await adapter.insertJob(createJob());
      const updated = await adapter.updateJob(job.id, {
        status: "failed",
        last_error: "something broke",
      });
      expect(updated.status).toBe("failed");
      expect(updated.last_error).toBe("something broke");
    });

    it("ignores id in updates", async () => {
      const job = await adapter.insertJob(createJob());
      const updated = await adapter.updateJob(job.id, {
        id: "should-not-change",
      } as any);
      expect(updated.id).toBe(job.id);
    });

    it("sets updated_at automatically", async () => {
      const job = await adapter.insertJob(createJob());
      const originalUpdatedAt = job.updated_at;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const updated = await adapter.updateJob(job.id, { status: "running" });
      expect(updated.updated_at >= originalUpdatedAt).toBe(true);
    });

    it("ignores unknown columns", async () => {
      const job = await adapter.insertJob(createJob());
      const updated = await adapter.updateJob(job.id, {
        nonexistent: "value",
      } as any);
      expect(updated.id).toBe(job.id);
    });
  });

  // -----------------------------------------------------------------------
  // deleteJob
  // -----------------------------------------------------------------------

  describe("deleteJob", () => {
    it("deletes an existing job", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.deleteJob(job.id);
      const fetched = await adapter.getJob(job.id);
      expect(fetched).toBeNull();
    });

    it("cascades to delete associated logs", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "hello",
        timestamp: new Date().toISOString(),
      });

      // Verify log exists
      const logsBefore = await adapter.getJobLogs(job.id);
      expect(logsBefore).toHaveLength(1);

      // Delete job — should cascade
      await adapter.deleteJob(job.id);

      const logsAfter = await adapter.getJobLogs(job.id);
      expect(logsAfter).toHaveLength(0);
    });

    it("does not throw for non-existent id", async () => {
      await expect(
        adapter.deleteJob("00000000-0000-7000-8000-000000000000"),
      ).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // claimNextJob
  // -----------------------------------------------------------------------

  describe("claimNextJob", () => {
    it("claims the next queued job", async () => {
      const job = await adapter.insertJob(createJob());
      const claimed = await adapter.claimNextJob(workerInfo);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(job.id);
    });

    it("returns null when no queued jobs exist", async () => {
      const claimed = await adapter.claimNextJob(workerInfo);
      expect(claimed).toBeNull();
    });

    it("skips jobs with future run_at", async () => {
      const future = new Date(Date.now() + 600_000).toISOString();
      await adapter.insertJob(createJob({ run_at: future }));
      const claimed = await adapter.claimNextJob(workerInfo);
      expect(claimed).toBeNull();
    });

    it("increments attempts by 1", async () => {
      const job = await adapter.insertJob(createJob());
      expect(job.attempts).toBe(0);

      const claimed = await adapter.claimNextJob(workerInfo);
      expect(claimed!.attempts).toBe(1);
    });

    it("sets status to 'running' and locked_until", async () => {
      await adapter.insertJob(createJob());
      const claimed = await adapter.claimNextJob(workerInfo);
      expect(claimed!.status).toBe("running");
      expect(claimed!.locked_until).not.toBeNull();
    });

    it("claims jobs in run_at order (earliest first)", async () => {
      const later = new Date(Date.now() + 1_000).toISOString();
      const now = new Date().toISOString();

      // Insert later first, then earlier
      await adapter.insertJob(createJob({ run_at: later }));
      const earlier = await adapter.insertJob(createJob({ run_at: now }));

      const claimed = await adapter.claimNextJob(workerInfo);
      expect(claimed!.id).toBe(earlier.id);
    });
  });

  // -----------------------------------------------------------------------
  // markSucceeded
  // -----------------------------------------------------------------------

  describe("markSucceeded", () => {
    it("sets status to 'succeeded' and clears locked_until", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.claimNextJob(workerInfo);

      await adapter.markSucceeded(job.id);
      const fetched = await adapter.getJob(job.id);
      expect(fetched!.status).toBe("succeeded");
      expect(fetched!.locked_until).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // markFailed
  // -----------------------------------------------------------------------

  describe("markFailed", () => {
    it("sets status to 'failed', stores error, clears locked_until", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.claimNextJob(workerInfo);

      await adapter.markFailed(job.id, "timeout error");
      const fetched = await adapter.getJob(job.id);
      expect(fetched!.status).toBe("failed");
      expect(fetched!.last_error).toBe("timeout error");
      expect(fetched!.locked_until).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // requeueJob
  // -----------------------------------------------------------------------

  describe("requeueJob", () => {
    it("sets status back to 'queued' and clears locked_until", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.claimNextJob(workerInfo);

      await adapter.requeueJob(job.id);
      const fetched = await adapter.getJob(job.id);
      expect(fetched!.status).toBe("queued");
      expect(fetched!.locked_until).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // recoverStaleJobs
  // -----------------------------------------------------------------------

  describe("recoverStaleJobs", () => {
    it("returns 0 when no stale jobs", async () => {
      const count = await adapter.recoverStaleJobs();
      expect(count).toBe(0);
    });

    it("recovers jobs with expired locked_until", async () => {
      const job = await adapter.insertJob(createJob());
      // Set to running with locked_until in the past
      const past = new Date(Date.now() - 60_000).toISOString();
      await adapter.updateJob(job.id, {
        status: "running",
        locked_until: past,
      });

      const count = await adapter.recoverStaleJobs();
      expect(count).toBe(1);

      const fetched = await adapter.getJob(job.id);
      expect(fetched!.status).toBe("queued");
      expect(fetched!.locked_until).toBeNull();
    });

    it("does not recover jobs with future locked_until", async () => {
      const job = await adapter.insertJob(createJob());
      const future = new Date(Date.now() + 600_000).toISOString();
      await adapter.updateJob(job.id, {
        status: "running",
        locked_until: future,
      });

      const count = await adapter.recoverStaleJobs();
      expect(count).toBe(0);

      const fetched = await adapter.getJob(job.id);
      expect(fetched!.status).toBe("running");
    });
  });

  // -----------------------------------------------------------------------
  // insertLog / getJobLogs
  // -----------------------------------------------------------------------

  describe("insertLog / getJobLogs", () => {
    it("inserts and retrieves logs for a job", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "started processing",
        timestamp: new Date().toISOString(),
      });

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].job_id).toBe(job.id);
      expect(logs[0].level).toBe("info");
      expect(logs[0].message).toBe("started processing");
    });

    it("filters logs by attempt number", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "attempt 1 log",
        timestamp: new Date().toISOString(),
      });
      await adapter.insertLog({
        job_id: job.id,
        attempt: 2,
        level: "error",
        message: "attempt 2 log",
        timestamp: new Date().toISOString(),
      });

      const attempt1Logs = await adapter.getJobLogs(job.id, 1);
      expect(attempt1Logs).toHaveLength(1);
      expect(attempt1Logs[0].message).toBe("attempt 1 log");

      const attempt2Logs = await adapter.getJobLogs(job.id, 2);
      expect(attempt2Logs).toHaveLength(1);
      expect(attempt2Logs[0].message).toBe("attempt 2 log");
    });

    it("returns empty array for job with no logs", async () => {
      const job = await adapter.insertJob(createJob());
      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toEqual([]);
    });

    it("returns logs ordered by timestamp", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "first",
        timestamp: new Date().toISOString(),
      });
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "second",
        timestamp: new Date().toISOString(),
      });

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe("first");
      expect(logs[1].message).toBe("second");
      expect(logs[0].timestamp <= logs[1].timestamp).toBe(true);
    });

    it("preserves the exact provided timestamp", async () => {
      const job = await adapter.insertJob(createJob());
      const hardcoded = "2024-03-15T08:30:00.456Z";
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "timestamp test",
        timestamp: hardcoded,
      });

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].timestamp).toBe(hardcoded);
    });
  });

  // -----------------------------------------------------------------------
  // insertLogs
  // -----------------------------------------------------------------------

  describe("insertLogs", () => {
    it("batch inserts multiple logs", async () => {
      const job = await adapter.insertJob(createJob());
      const now = new Date().toISOString();

      await adapter.insertLogs([
        { job_id: job.id, attempt: 1, level: "info", message: "log 1", timestamp: now },
        { job_id: job.id, attempt: 1, level: "warn", message: "log 2", timestamp: now },
        { job_id: job.id, attempt: 1, level: "error", message: "log 3", timestamp: now },
      ]);

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(3);
    });

    it("no-op for empty array", async () => {
      await adapter.insertLogs([]);
      // No error, and no rows inserted — just verify it doesn't throw
    });

    it("preserves the provided timestamp", async () => {
      const job = await adapter.insertJob(createJob());
      const specificTimestamp = "2025-06-15T12:30:45.123Z";

      await adapter.insertLogs([
        { job_id: job.id, attempt: 1, level: "info", message: "test", timestamp: specificTimestamp },
      ]);

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].timestamp).toBe(specificTimestamp);
    });
  });

  // -----------------------------------------------------------------------
  // getJobCounts
  // -----------------------------------------------------------------------

  describe("getJobCounts", () => {
    it("returns all four statuses as 0 for empty db", async () => {
      const counts = await adapter.getJobCounts();
      expect(counts).toEqual({
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
      });
    });

    it("returns correct counts after operations", async () => {
      const j1 = await adapter.insertJob(createJob());
      const j2 = await adapter.insertJob(createJob());
      await adapter.insertJob(createJob()); // stays queued

      await adapter.claimNextJob(workerInfo); // j1 → running
      await adapter.markSucceeded(j1.id);

      await adapter.claimNextJob(workerInfo); // j2 → running
      await adapter.markFailed(j2.id, "error");

      const counts = await adapter.getJobCounts();
      expect(counts.queued).toBe(1);
      expect(counts.running).toBe(0);
      expect(counts.succeeded).toBe(1);
      expect(counts.failed).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // deleteOldJobs
  // -----------------------------------------------------------------------

  describe("deleteOldJobs", () => {
    it("deletes jobs older than the given date in specified statuses", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.markSucceeded(job.id);

      // Backdate the job's updated_at
      const oldDate = new Date(Date.now() - 86_400_000).toISOString();
      await adapter.updateJob(job.id, { status: "succeeded" });
      // Force backdate via a second update trick: updateJob always sets updated_at to now,
      // so we need to use a boundary that's in the future relative to the job
      const boundary = new Date(Date.now() + 1_000);

      const count = await adapter.deleteOldJobs(boundary, ["succeeded"]);
      expect(count).toBe(1);

      const fetched = await adapter.getJob(job.id);
      expect(fetched).toBeNull();
    });

    it("does not delete jobs in non-specified statuses", async () => {
      const job = await adapter.insertJob(createJob()); // status: queued

      const boundary = new Date(Date.now() + 1_000);
      const count = await adapter.deleteOldJobs(boundary, ["succeeded", "failed"]);
      expect(count).toBe(0);

      const fetched = await adapter.getJob(job.id);
      expect(fetched).not.toBeNull();
    });

    it("returns 0 for empty statuses array", async () => {
      await adapter.insertJob(createJob());
      const count = await adapter.deleteOldJobs(new Date(), []);
      expect(count).toBe(0);
    });

    it("returns count of deleted jobs", async () => {
      const j1 = await adapter.insertJob(createJob());
      const j2 = await adapter.insertJob(createJob());
      await adapter.insertJob(createJob()); // stays queued

      await adapter.markSucceeded(j1.id);
      await adapter.markSucceeded(j2.id);

      const boundary = new Date(Date.now() + 1_000);
      const count = await adapter.deleteOldJobs(boundary, ["succeeded"]);
      expect(count).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // deleteOldLogs
  // -----------------------------------------------------------------------

  describe("deleteOldLogs", () => {
    it("deletes logs older than the given date", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "old log",
        timestamp: new Date().toISOString(),
      });

      const boundary = new Date(Date.now() + 1_000);
      const count = await adapter.deleteOldLogs(boundary);
      expect(count).toBe(1);

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(0);
    });

    it("returns count of deleted logs", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "log 1",
        timestamp: new Date().toISOString(),
      });
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "warn",
        message: "log 2",
        timestamp: new Date().toISOString(),
      });

      const boundary = new Date(Date.now() + 1_000);
      const count = await adapter.deleteOldLogs(boundary);
      expect(count).toBe(2);
    });

    it("does not delete recent logs", async () => {
      const job = await adapter.insertJob(createJob());
      await adapter.insertLog({
        job_id: job.id,
        attempt: 1,
        level: "info",
        message: "recent log",
        timestamp: new Date().toISOString(),
      });

      // Boundary in the past — nothing should be deleted
      const boundary = new Date(Date.now() - 60_000);
      const count = await adapter.deleteOldLogs(boundary);
      expect(count).toBe(0);

      const logs = await adapter.getJobLogs(job.id);
      expect(logs).toHaveLength(1);
    });
  });
});
