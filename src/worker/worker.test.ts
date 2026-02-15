import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWorker } from "./worker.js";
import { clear, register } from "../core/registry.js";
import {
  installConsoleInterceptors,
  removeConsoleInterceptors,
} from "./logging.js";
import type { DatabaseAdapter } from "../db/adapter.js";
import type { Job } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    job_type: "test.job",
    args: '["hello",42]',
    status: "running",
    attempts: 1,
    max_attempts: 3,
    run_at: new Date().toISOString(),
    locked_until: new Date(Date.now() + 300_000).toISOString(),
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
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    insertJob: vi.fn(async () => makeJob()),
    getJob: vi.fn(async () => null),
    listJobs: vi.fn(async () => ({ jobs: [], total: 0 })),
    updateJob: vi.fn(async (_id, updates) => ({ ...makeJob(), ...updates }) as Job),
    deleteJob: vi.fn(async () => {}),
    claimNextJob: vi.fn(async () => null),
    markSucceeded: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    requeueJob: vi.fn(async () => {}),
    recoverStaleJobs: vi.fn(async () => 0),
    insertLog: vi.fn(async () => {}),
    insertLogs: vi.fn(async () => {}),
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
// Test suite
// ---------------------------------------------------------------------------

describe("createWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe("lifecycle", () => {
    it("returns an object with start and stop functions", () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter);
      expect(typeof worker.start).toBe("function");
      expect(typeof worker.stop).toBe("function");
    });

    it("start is idempotent — calling twice does not create duplicate timers", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, { pollingInterval: 100 });

      worker.start();
      worker.start(); // second call should be a no-op

      await vi.advanceTimersByTimeAsync(100);

      // Only one poll should have fired
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      await worker.stop();
    });

    it("stop is idempotent — calling twice resolves without error", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter);

      worker.start();
      await worker.stop();
      await worker.stop(); // second call should be a no-op
    });

    it("stop before start resolves without error", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter);
      await worker.stop(); // should not throw
    });
  });

  // =========================================================================
  // Poll loop basics
  // =========================================================================

  describe("poll loop basics", () => {
    it("polls after start", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, { pollingInterval: 100 });

      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);
      await worker.stop();
    });

    it("passes correct workerInfo to claimNextJob", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        leaseTimeout: 60_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      const call = vi.mocked(adapter.claimNextJob).mock.calls[0][0];
      expect(call.worker_id).toBeDefined();
      expect(typeof call.worker_id).toBe("string");
      expect(call.lease_duration_ms).toBe(60_000);

      await worker.stop();
    });

    it("calls handler with deserialized args", async () => {
      const handler = vi.fn(async () => {});
      register("test.job", handler);

      const job = makeJob({ args: '["hello",42]' });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(handler).toHaveBeenCalledWith("hello", 42);
      await worker.stop();
    });

    it("marks succeeded on handler completion", async () => {
      register("test.job", async () => {});

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.markSucceeded).toHaveBeenCalledWith("job-1");
      await worker.stop();
    });

    it("polls again after processing a job", async () => {
      register("test.job", async () => {});

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();

      // First tick: claims job
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Second tick: polls again (interval resets to base after finding job)
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      await worker.stop();
    });
  });

  // =========================================================================
  // Adaptive backoff
  // =========================================================================

  describe("adaptive backoff", () => {
    it("uses base interval initially", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, { pollingInterval: 200 });

      worker.start();

      // Should not have polled yet at t=0
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(0);

      // Should poll at t=200
      await vi.advanceTimersByTimeAsync(200);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      await worker.stop();
    });

    it("increases interval by multiplier when no job found", async () => {
      const adapter = createMockAdapter(); // claimNextJob returns null
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 2,
        maxPollingInterval: 10_000,
      });

      worker.start();

      // First poll at t=100
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Next poll at t=100+200=300 (interval doubled)
      await vi.advanceTimersByTimeAsync(200);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      // Next poll at t=300+400=700 (interval doubled again)
      await vi.advanceTimersByTimeAsync(400);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(3);

      await worker.stop();
    });

    it("caps at maxPollingInterval", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 100, // aggressive multiplier
        maxPollingInterval: 500,
      });

      worker.start();

      // First poll at t=100
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // After first empty poll, interval = min(100*100, 500) = 500
      // Next poll at t=100+500=600
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      // Stays capped at 500
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(3);

      await worker.stop();
    });

    it("resets to base interval when a job is found", async () => {
      register("test.job", async () => {});

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(null)  // first poll: empty
          .mockResolvedValueOnce(job)   // second poll: found job
          .mockResolvedValue(null),     // third poll onwards: empty
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 2,
        maxPollingInterval: 10_000,
      });

      worker.start();

      // First poll at t=100 (empty → interval becomes 200)
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Second poll at t=100+200=300 (found job → interval resets to 100)
      await vi.advanceTimersByTimeAsync(200);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      // Third poll at t=300+100=400 (back to base interval)
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(3);

      await worker.stop();
    });
  });

  // =========================================================================
  // Handler lookup failures
  // =========================================================================

  describe("handler lookup failures", () => {
    it("marks failed when no handler is registered", async () => {
      // Don't register any handler for "test.job"
      const job = makeJob({ job_type: "unregistered.job" });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.markFailed).toHaveBeenCalledWith(
        "job-1",
        "No handler registered for job type: unregistered.job",
      );
      await worker.stop();
    });

    it("marks failed on invalid JSON args", async () => {
      register("test.job", async () => {});

      const job = makeJob({ args: "not-valid-json{{{" });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.markFailed).toHaveBeenCalledWith(
        "job-1",
        expect.stringContaining("Failed to parse job arguments"),
      );
      await worker.stop();
    });
  });

  // =========================================================================
  // Retry logic
  // =========================================================================

  describe("retry logic", () => {
    it("retries when attempts < max_attempts", async () => {
      register("test.job", async () => {
        throw new Error("boom");
      });

      const job = makeJob({ attempts: 1, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.updateJob).toHaveBeenCalledWith("job-1", {
        status: "queued",
        run_at: expect.any(String),
        locked_until: null,
        last_error: expect.stringContaining("boom"),
      });
      expect(adapter.markFailed).not.toHaveBeenCalled();

      await worker.stop();
    });

    it("sets future run_at with backoff delay on retry", async () => {
      register("test.job", async () => {
        throw new Error("fail");
      });

      const job = makeJob({ attempts: 1, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const now = Date.now();
      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      const updateCall = vi.mocked(adapter.updateJob).mock.calls[0];
      const updates = updateCall[1];
      const runAt = new Date(updates.run_at!).getTime();

      // run_at should be in the future (now + some backoff)
      expect(runAt).toBeGreaterThan(now);

      await worker.stop();
    });

    it("permanently fails when attempts >= max_attempts", async () => {
      register("test.job", async () => {
        throw new Error("final failure");
      });

      const job = makeJob({ attempts: 3, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.markFailed).toHaveBeenCalledWith(
        "job-1",
        expect.stringContaining("final failure"),
      );
      expect(adapter.updateJob).not.toHaveBeenCalled();

      await worker.stop();
    });

    it("uses the correct backoff strategy from registered job options", async () => {
      // Register with "fixed" backoff — calculateBackoff("fixed") returns baseMs (1000)
      register("test.fixed", async () => {
        throw new Error("fail");
      }, { backoff: "fixed" });

      const job = makeJob({
        job_type: "test.fixed",
        attempts: 1,
        max_attempts: 5,
      });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const now = Date.now();
      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      const updates = vi.mocked(adapter.updateJob).mock.calls[0][1];
      const runAt = new Date(updates.run_at!).getTime();

      // Fixed backoff = 1000ms, so run_at should be ~now + 1000
      expect(runAt).toBeGreaterThanOrEqual(now + 1000);
      expect(runAt).toBeLessThanOrEqual(now + 2000);

      await worker.stop();
    });

    it("formats Error with message and stack trace", async () => {
      const testError = new Error("test error message");
      register("test.job", async () => {
        throw testError;
      });

      const job = makeJob({ attempts: 3, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      const errorArg = vi.mocked(adapter.markFailed).mock.calls[0][1];
      expect(errorArg).toContain("test error message");
      expect(errorArg).toContain("Error:");

      await worker.stop();
    });

    it("handles non-Error thrown values", async () => {
      register("test.job", async () => {
        throw "string error";
      });

      const job = makeJob({ attempts: 3, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.markFailed).toHaveBeenCalledWith(
        "job-1",
        "string error",
      );

      await worker.stop();
    });
  });

  // =========================================================================
  // Stale recovery
  // =========================================================================

  describe("stale recovery", () => {
    it("calls recoverStaleJobs at staleCheckInterval", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        staleCheckInterval: 500,
      });

      worker.start();

      // Advance past staleCheckInterval
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.recoverStaleJobs).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.recoverStaleJobs).toHaveBeenCalledTimes(2);

      await worker.stop();
    });

    it("silently ignores recovery errors", async () => {
      const adapter = createMockAdapter({
        recoverStaleJobs: vi.fn().mockRejectedValue(new Error("DB down")),
      });
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        staleCheckInterval: 500,
      });

      worker.start();

      // Should not throw
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.recoverStaleJobs).toHaveBeenCalled();

      await worker.stop();
    });
  });

  // =========================================================================
  // Graceful shutdown
  // =========================================================================

  describe("graceful shutdown", () => {
    it("clears both timers on stop", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        staleCheckInterval: 500,
      });

      worker.start();
      await worker.stop();

      // After stopping, advancing time should not trigger more polls
      const callCount = vi.mocked(adapter.claimNextJob).mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(callCount);
    });

    it("waits for in-flight job to complete", async () => {
      let resolveJob!: () => void;
      const jobPromise = new Promise<void>((r) => { resolveJob = r; });

      register("test.job", async () => {
        await jobPromise;
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        shutdownTimeout: 5000,
      });
      worker.start();

      // Trigger the poll tick to pick up the job
      await vi.advanceTimersByTimeAsync(100);

      // Start shutdown (won't resolve until job finishes or timeout)
      let stopped = false;
      const stopPromise = worker.stop().then(() => { stopped = true; });

      // Job is still running
      expect(stopped).toBe(false);

      // Complete the job
      resolveJob();
      await stopPromise;

      expect(stopped).toBe(true);
      expect(adapter.markSucceeded).toHaveBeenCalledWith("job-1");
    });

    it("times out after shutdownTimeout if job does not finish", async () => {
      // Job that never resolves
      register("test.job", async () => {
        await new Promise(() => {}); // never resolves
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        shutdownTimeout: 2000,
      });
      worker.start();

      // Trigger poll
      await vi.advanceTimersByTimeAsync(100);

      let stopped = false;
      const stopPromise = worker.stop().then(() => { stopped = true; });

      // Not stopped yet
      expect(stopped).toBe(false);

      // Advance past shutdown timeout
      await vi.advanceTimersByTimeAsync(2000);
      await stopPromise;

      expect(stopped).toBe(true);
    });

    it("does not claim new jobs after stop", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, { pollingInterval: 100 });

      worker.start();
      await worker.stop();

      // Advance time — no new polls should fire
      await vi.advanceTimersByTimeAsync(1000);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(0);
    });
  });

  // =========================================================================
  // Configuration
  // =========================================================================

  describe("configuration", () => {
    it("uses custom pollingInterval", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, { pollingInterval: 50 });

      worker.start();

      await vi.advanceTimersByTimeAsync(50);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Should not have polled at 25ms
      await worker.stop();
    });

    it("uses custom maxPollingInterval", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 1000, // very aggressive
        maxPollingInterval: 200,
      });

      worker.start();

      // First poll at 100
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Second poll capped at 200 (not 100*1000)
      await vi.advanceTimersByTimeAsync(200);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      await worker.stop();
    });

    it("uses custom leaseTimeout in workerInfo", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        leaseTimeout: 120_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      const workerInfo = vi.mocked(adapter.claimNextJob).mock.calls[0][0];
      expect(workerInfo.lease_duration_ms).toBe(120_000);

      await worker.stop();
    });

    it("uses custom staleCheckInterval", async () => {
      const adapter = createMockAdapter();
      const worker = createWorker(adapter, {
        pollingInterval: 100,
        staleCheckInterval: 250,
      });

      worker.start();

      await vi.advanceTimersByTimeAsync(250);
      expect(adapter.recoverStaleJobs).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(250);
      expect(adapter.recoverStaleJobs).toHaveBeenCalledTimes(2);

      await worker.stop();
    });

    it("uses custom shutdownTimeout", async () => {
      // Job that never resolves
      register("test.job", async () => {
        await new Promise(() => {});
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        shutdownTimeout: 500,
      });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      let stopped = false;
      const stopPromise = worker.stop().then(() => { stopped = true; });

      // Advance less than shutdownTimeout — should not have stopped
      await vi.advanceTimersByTimeAsync(400);
      expect(stopped).toBe(false);

      // Advance past shutdownTimeout
      await vi.advanceTimersByTimeAsync(100);
      await stopPromise;
      expect(stopped).toBe(true);
    });
  });

  // =========================================================================
  // Job-scoped logging integration
  // =========================================================================

  describe("job-scoped logging integration", () => {
    beforeEach(() => {
      installConsoleInterceptors();
    });

    afterEach(() => {
      removeConsoleInterceptors();
    });

    it("flushes captured logs after successful job", async () => {
      register("test.job", async () => {
        console.log("handler output");
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.insertLogs).toHaveBeenCalledTimes(1);
      const logs = vi.mocked(adapter.insertLogs).mock.calls[0][0];
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("info");
      expect(logs[0].message).toBe("handler output");
      expect(logs[0].job_id).toBe("job-1");

      await worker.stop();
    });

    it("flushes captured logs after failed job", async () => {
      register("test.job", async () => {
        console.error("about to fail");
        throw new Error("boom");
      });

      const job = makeJob({ attempts: 3, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.insertLogs).toHaveBeenCalledTimes(1);
      const logs = vi.mocked(adapter.insertLogs).mock.calls[0][0];
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("error");
      expect(logs[0].message).toBe("about to fail");

      await worker.stop();
    });

    it("flush failure does not prevent status marking", async () => {
      register("test.job", async () => {
        console.log("some output");
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
        insertLogs: vi.fn().mockRejectedValue(new Error("DB write failed")),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.markSucceeded).toHaveBeenCalledWith("job-1");

      await worker.stop();
    });

    it("flushes captured logs on retry (attempts < max_attempts)", async () => {
      register("test.job", async () => {
        console.log("before failure");
        throw new Error("retry me");
      });

      const job = makeJob({ attempts: 1, max_attempts: 3 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      // Job should retry (updateJob called, not markFailed)
      expect(adapter.updateJob).toHaveBeenCalled();
      expect(adapter.markFailed).not.toHaveBeenCalled();

      // Logs should still be flushed
      expect(adapter.insertLogs).toHaveBeenCalledTimes(1);
      const logs = vi.mocked(adapter.insertLogs).mock.calls[0][0];
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("before failure");

      await worker.stop();
    });

    it("flushed logs carry the correct job_id and attempt", async () => {
      register("test.job", async () => {
        console.log("identity check");
      });

      const job = makeJob({ id: "job-xyz", attempts: 5 });
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.insertLogs).toHaveBeenCalledTimes(1);
      const logs = vi.mocked(adapter.insertLogs).mock.calls[0][0];
      expect(logs[0].job_id).toBe("job-xyz");
      expect(logs[0].attempt).toBe(5);

      await worker.stop();
    });

    it("multiple console methods produce entries with correct levels", async () => {
      register("test.job", async () => {
        console.log("info msg");
        console.warn("warn msg");
        console.error("error msg");
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.insertLogs).toHaveBeenCalledTimes(1);
      const logs = vi.mocked(adapter.insertLogs).mock.calls[0][0];
      expect(logs).toHaveLength(3);
      expect(logs[0].level).toBe("info");
      expect(logs[0].message).toBe("info msg");
      expect(logs[1].level).toBe("warn");
      expect(logs[1].message).toBe("warn msg");
      expect(logs[2].level).toBe("error");
      expect(logs[2].message).toBe("error msg");

      await worker.stop();
    });

    it("no flush when handler produces no output", async () => {
      register("test.job", async () => {
        // no console output
      });

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, { pollingInterval: 100 });
      worker.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(adapter.insertLogs).not.toHaveBeenCalled();

      await worker.stop();
    });
  });

  // =========================================================================
  // Error resilience
  // =========================================================================

  describe("error resilience", () => {
    it("continues polling after claimNextJob throws", async () => {
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockRejectedValueOnce(new Error("DB error"))
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 1, // keep interval constant for easy testing
        maxPollingInterval: 100,
      });
      worker.start();

      // First poll: throws
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Second poll: succeeds (worker kept going)
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      await worker.stop();
    });

    it("applies backoff after DB error", async () => {
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockRejectedValueOnce(new Error("DB error"))
          .mockResolvedValue(null),
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 2,
        maxPollingInterval: 10_000,
      });
      worker.start();

      // First poll at t=100: throws
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);

      // Next poll at t=100+200=300 (interval doubled due to error)
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1); // not yet
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      await worker.stop();
    });

    it("continues polling after markSucceeded throws", async () => {
      register("test.job", async () => {});

      const job = makeJob();
      const adapter = createMockAdapter({
        claimNextJob: vi.fn()
          .mockResolvedValueOnce(job)
          .mockResolvedValue(null),
        markSucceeded: vi.fn().mockRejectedValueOnce(new Error("DB write error")),
      });

      const worker = createWorker(adapter, {
        pollingInterval: 100,
        backoffMultiplier: 1,
        maxPollingInterval: 100,
      });
      worker.start();

      // First poll: claims job, handler succeeds, markSucceeded throws
      // Error propagates to pollTick catch → applies backoff → schedules next poll
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(1);
      expect(adapter.markSucceeded).toHaveBeenCalled();

      // Second poll: worker still alive
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.claimNextJob).toHaveBeenCalledTimes(2);

      await worker.stop();
    });
  });
});
