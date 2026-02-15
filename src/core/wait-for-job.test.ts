import { describe, it, expect, vi } from "vitest";
import { waitForJob } from "./wait-for-job.js";
import type { DatabaseAdapter } from "../db/adapter.js";
import type { Job } from "../types.js";

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    job_type: "test",
    args: "[]",
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    run_at: new Date().toISOString(),
    locked_until: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockAdapter(
  overrides?: Partial<DatabaseAdapter>,
): DatabaseAdapter {
  return {
    initialize: async () => {},
    close: async () => {},
    insertJob: async () => makeJob(),
    getJob: async () => null,
    listJobs: async () => ({ jobs: [], total: 0 }),
    updateJob: async () => makeJob(),
    deleteJob: async () => {},
    claimNextJob: async () => null,
    markSucceeded: async () => {},
    markFailed: async () => {},
    requeueJob: async () => {},
    recoverStaleJobs: async () => 0,
    insertLog: async () => {},
    insertLogs: async () => {},
    getJobLogs: async () => [],
    getJobCounts: async () => ({
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    }),
    deleteOldJobs: async () => 0,
    deleteOldLogs: async () => 0,
    ...overrides,
  };
}

describe("waitForJob", () => {
  it("resolves immediately if job already succeeded", async () => {
    const job = makeJob({ status: "succeeded" });
    const adapter = createMockAdapter({ getJob: async () => job });

    const result = await waitForJob(adapter, "job-1");
    expect(result).toBe(job);
  });

  it("resolves immediately if job already failed", async () => {
    const job = makeJob({ status: "failed", last_error: "boom" });
    const adapter = createMockAdapter({ getJob: async () => job });

    const result = await waitForJob(adapter, "job-1");
    expect(result.status).toBe("failed");
  });

  it("polls until job transitions to succeeded", async () => {
    let calls = 0;
    const adapter = createMockAdapter({
      getJob: async () => {
        calls++;
        if (calls < 3) return makeJob({ status: "running" });
        return makeJob({ status: "succeeded" });
      },
    });

    const result = await waitForJob(adapter, "job-1", {
      pollingInterval: 10,
    });
    expect(result.status).toBe("succeeded");
    expect(calls).toBe(3);
  });

  it("throws on timeout", async () => {
    const adapter = createMockAdapter({
      getJob: async () => makeJob({ status: "running" }),
    });

    await expect(
      waitForJob(adapter, "job-1", { pollingInterval: 10, timeout: 50 }),
    ).rejects.toThrow(/Timed out waiting for job job-1/);
  });

  it("throws if job not found", async () => {
    const adapter = createMockAdapter({ getJob: async () => null });

    await expect(waitForJob(adapter, "missing-id")).rejects.toThrow(
      "Job not found: missing-id",
    );
  });

  it("respects custom pollingInterval", async () => {
    let calls = 0;
    const adapter = createMockAdapter({
      getJob: async () => {
        calls++;
        if (calls < 2) return makeJob({ status: "running" });
        return makeJob({ status: "succeeded" });
      },
    });

    const start = Date.now();
    await waitForJob(adapter, "job-1", { pollingInterval: 100 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it("respects custom timeout", async () => {
    const adapter = createMockAdapter({
      getJob: async () => makeJob({ status: "queued" }),
    });

    const start = Date.now();
    await expect(
      waitForJob(adapter, "job-1", { pollingInterval: 10, timeout: 100 }),
    ).rejects.toThrow(/Timed out/);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(500);
  });
});
