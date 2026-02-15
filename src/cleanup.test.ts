import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DatabaseAdapter } from "./db/adapter.js";
import { runCleanup, createCleanupScheduler } from "./cleanup.js";

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(
  overrides?: Partial<DatabaseAdapter>,
): DatabaseAdapter {
  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    insertJob: vi.fn() as any,
    getJob: vi.fn() as any,
    listJobs: vi.fn() as any,
    updateJob: vi.fn() as any,
    deleteJob: vi.fn() as any,
    claimNextJob: vi.fn(async () => null),
    markSucceeded: vi.fn() as any,
    markFailed: vi.fn() as any,
    requeueJob: vi.fn() as any,
    recoverStaleJobs: vi.fn(async () => 0),
    insertLog: vi.fn() as any,
    insertLogs: vi.fn() as any,
    getJobLogs: vi.fn(async () => []),
    getJobCounts: vi.fn(async () => ({
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    })),
    deleteOldJobs: vi.fn(async () => 0),
    deleteOldLogs: vi.fn(async () => 0),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runCleanup()
// ---------------------------------------------------------------------------

describe("runCleanup", () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes succeeded jobs older than 7d by default", async () => {
    await runCleanup(adapter);

    const call = vi.mocked(adapter.deleteOldJobs).mock.calls.find(
      ([, statuses]) => statuses.includes("succeeded"),
    );
    expect(call).toBeDefined();
    const [olderThan, statuses] = call!;
    expect(statuses).toEqual(["succeeded"]);
    // 7 days = 604800000 ms
    const expected = new Date(Date.now() - 604_800_000);
    expect(olderThan.getTime()).toBe(expected.getTime());
  });

  it("deletes failed jobs older than 14d by default", async () => {
    await runCleanup(adapter);

    const call = vi.mocked(adapter.deleteOldJobs).mock.calls.find(
      ([, statuses]) => statuses.includes("failed"),
    );
    expect(call).toBeDefined();
    const [olderThan, statuses] = call!;
    expect(statuses).toEqual(["failed"]);
    const expected = new Date(Date.now() - 14 * 86_400_000);
    expect(olderThan.getTime()).toBe(expected.getTime());
  });

  it("deletes old logs with 14d default retention", async () => {
    await runCleanup(adapter);

    expect(adapter.deleteOldLogs).toHaveBeenCalledOnce();
    const [olderThan] = vi.mocked(adapter.deleteOldLogs).mock.calls[0];
    const expected = new Date(Date.now() - 14 * 86_400_000);
    expect(olderThan.getTime()).toBe(expected.getTime());
  });

  it("never deletes queued or running jobs", async () => {
    await runCleanup(adapter);

    for (const [, statuses] of vi.mocked(adapter.deleteOldJobs).mock.calls) {
      expect(statuses).not.toContain("queued");
      expect(statuses).not.toContain("running");
    }
  });

  it("respects custom retention durations", async () => {
    await runCleanup(adapter, {
      succeededJobRetention: "1d",
      failedJobRetention: "3d",
      logRetention: "2d",
    });

    const succeededCall = vi.mocked(adapter.deleteOldJobs).mock.calls.find(
      ([, statuses]) => statuses.includes("succeeded"),
    )!;
    expect(succeededCall[0].getTime()).toBe(
      new Date(Date.now() - 86_400_000).getTime(),
    );

    const failedCall = vi.mocked(adapter.deleteOldJobs).mock.calls.find(
      ([, statuses]) => statuses.includes("failed"),
    )!;
    expect(failedCall[0].getTime()).toBe(
      new Date(Date.now() - 3 * 86_400_000).getTime(),
    );

    const [logCutoff] = vi.mocked(adapter.deleteOldLogs).mock.calls[0];
    expect(logCutoff.getTime()).toBe(
      new Date(Date.now() - 2 * 86_400_000).getTime(),
    );
  });

  it("accepts numeric (ms) retention values", async () => {
    await runCleanup(adapter, {
      succeededJobRetention: 60_000,
      failedJobRetention: 120_000,
      logRetention: 180_000,
    });

    const succeededCall = vi.mocked(adapter.deleteOldJobs).mock.calls.find(
      ([, statuses]) => statuses.includes("succeeded"),
    )!;
    expect(succeededCall[0].getTime()).toBe(
      new Date(Date.now() - 60_000).getTime(),
    );
  });

  it("returns counts of deleted jobs and logs", async () => {
    vi.mocked(adapter.deleteOldJobs)
      .mockResolvedValueOnce(5)  // succeeded
      .mockResolvedValueOnce(3); // failed
    vi.mocked(adapter.deleteOldLogs).mockResolvedValueOnce(10);

    const result = await runCleanup(adapter);

    expect(result).toEqual({ jobsDeleted: 8, logsDeleted: 10 });
  });

  it("batches deletion — loops until fewer than batchSize rows deleted", async () => {
    vi.mocked(adapter.deleteOldJobs)
      // Succeeded: first batch returns batchSize (100), second returns less
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(42)
      // Failed: returns less than batchSize immediately
      .mockResolvedValueOnce(10);
    vi.mocked(adapter.deleteOldLogs).mockResolvedValueOnce(0);

    const result = await runCleanup(adapter, { cleanupBatchSize: 100 });

    // 3 calls to deleteOldJobs: 2 for succeeded (batch loop), 1 for failed
    expect(adapter.deleteOldJobs).toHaveBeenCalledTimes(3);
    expect(result.jobsDeleted).toBe(100 + 42 + 10);
  });
});

// ---------------------------------------------------------------------------
// createCleanupScheduler
// ---------------------------------------------------------------------------

describe("createCleanupScheduler", () => {
  let adapter: DatabaseAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() sets up an interval that calls runCleanup", async () => {
    const scheduler = createCleanupScheduler(adapter, {
      cleanupInterval: "1h",
    });
    scheduler.start();

    // Advance 1 hour
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(adapter.deleteOldJobs).toHaveBeenCalled();
    expect(adapter.deleteOldLogs).toHaveBeenCalled();

    scheduler.stop();
  });

  it("stop() clears the interval", async () => {
    const scheduler = createCleanupScheduler(adapter, {
      cleanupInterval: "1h",
    });
    scheduler.start();
    scheduler.stop();

    // Advance past the interval — should NOT trigger cleanup
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(adapter.deleteOldJobs).not.toHaveBeenCalled();
  });

  it("start() is idempotent", () => {
    const scheduler = createCleanupScheduler(adapter, {
      cleanupInterval: "1h",
    });
    scheduler.start();
    scheduler.start(); // should not set up a second timer

    scheduler.stop();
  });

  it("stop() is idempotent", () => {
    const scheduler = createCleanupScheduler(adapter);
    scheduler.stop(); // should not throw even if never started
    scheduler.stop();
  });

  it("runOnce() executes cleanup immediately without waiting for interval", async () => {
    const scheduler = createCleanupScheduler(adapter);

    vi.mocked(adapter.deleteOldJobs).mockResolvedValue(2);
    vi.mocked(adapter.deleteOldLogs).mockResolvedValue(5);

    const result = await scheduler.runOnce();

    expect(result.jobsDeleted).toBe(4); // 2 succeeded + 2 failed
    expect(result.logsDeleted).toBe(5);
  });

  it("swallows errors from cleanup (logs them, does not throw)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(adapter.deleteOldJobs).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const scheduler = createCleanupScheduler(adapter, {
      cleanupInterval: "1h",
    });
    scheduler.start();

    // Advance to trigger the interval — should not throw
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[dashq] Cleanup failed:",
      expect.any(Error),
    );

    scheduler.stop();
    consoleSpy.mockRestore();
  });

  it("logs when jobs or logs are deleted during interval tick", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.mocked(adapter.deleteOldJobs).mockResolvedValue(5);
    vi.mocked(adapter.deleteOldLogs).mockResolvedValue(10);

    const scheduler = createCleanupScheduler(adapter, {
      cleanupInterval: "1h",
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dashq] Cleanup:"),
    );

    scheduler.stop();
    consoleSpy.mockRestore();
  });

  it("does not log when nothing is deleted", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.mocked(adapter.deleteOldJobs).mockResolvedValue(0);
    vi.mocked(adapter.deleteOldLogs).mockResolvedValue(0);

    const scheduler = createCleanupScheduler(adapter, {
      cleanupInterval: "1h",
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[dashq] Cleanup:"),
    );

    scheduler.stop();
    consoleSpy.mockRestore();
  });
});
