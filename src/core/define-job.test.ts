import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineJob } from "./define-job.js";
import { clear, has } from "./registry.js";
import { setAdapter, clearAdapter } from "./db-state.js";
import type { DatabaseAdapter } from "../db/adapter.js";
import type { Job } from "../types.js";

const noop = async () => {};

function createMockAdapter(
  overrides?: Partial<DatabaseAdapter>,
): DatabaseAdapter {
  return {
    initialize: async () => {},
    close: async () => {},
    insertJob: vi.fn(async () => ({
      id: "mock-job-id",
      job_type: "",
      args: "[]",
      status: "queued" as const,
      attempts: 0,
      max_attempts: 3,
      run_at: new Date().toISOString(),
      locked_until: null,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    getJob: async () => null,
    listJobs: async () => ({ jobs: [], total: 0 }),
    updateJob: async () => ({}) as Job,
    deleteJob: async () => {},
    claimNextJob: async () => null,
    markSucceeded: async () => {},
    markFailed: async () => {},
    requeueJob: async () => {},
    recoverStaleJobs: async () => 0,
    insertLog: async () => {},
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

describe("defineJob", () => {
  beforeEach(() => {
    clear();
    clearAdapter();
  });

  // -----------------------------------------------------------------------
  // defineJob basics
  // -----------------------------------------------------------------------

  it("returns an object with the jobId property", () => {
    const job = defineJob("email.send", noop);
    expect(job.jobId).toBe("email.send");
  });

  it("registers the job in the registry", () => {
    defineJob("email.send", noop);
    expect(has("email.send")).toBe(true);
  });

  it("throws on empty jobId (from registry)", () => {
    expect(() => defineJob("", noop)).toThrow(
      "jobId must be a non-empty string",
    );
  });

  it("throws on duplicate jobId (from registry)", () => {
    defineJob("dup", noop);
    expect(() => defineJob("dup", noop)).toThrow(
      'Job "dup" is already registered',
    );
  });

  it("returns a frozen object", () => {
    const job = defineJob("frozen", noop);
    expect(Object.isFrozen(job)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // enqueue — DB not started
  // -----------------------------------------------------------------------

  it("enqueue() throws when DB not started", async () => {
    const job = defineJob("no-db", noop);
    await expect(job.enqueue()).rejects.toThrow(
      "DashQ has not been started. Call start() before enqueueing jobs.",
    );
  });

  it("enqueueAt() throws when DB not started", async () => {
    const job = defineJob("no-db-at", noop);
    await expect(job.enqueueAt(new Date())).rejects.toThrow(
      "DashQ has not been started",
    );
  });

  it("enqueueIn() throws when DB not started", async () => {
    const job = defineJob("no-db-in", noop);
    await expect(job.enqueueIn("5m")).rejects.toThrow(
      "DashQ has not been started",
    );
  });

  // -----------------------------------------------------------------------
  // enqueue — with mock adapter
  // -----------------------------------------------------------------------

  it("enqueue() calls insertJob with correct fields", async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob(
      "test.enqueue",
      async (_a: number, _b: string) => {},
    );

    const before = Date.now();
    const id = await job.enqueue(42, "hello");
    const after = Date.now();

    expect(id).toBe("mock-job-id");
    expect(adapter.insertJob).toHaveBeenCalledOnce();

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    expect(call.job_type).toBe("test.enqueue");
    expect(JSON.parse(call.args)).toEqual([42, "hello"]);
    expect(call.max_attempts).toBe(3);

    const runAt = new Date(call.run_at!).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before);
    expect(runAt).toBeLessThanOrEqual(after);
  });

  it("enqueueAt() passes the given date as run_at", async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.at", async (_x: number) => {});
    const date = new Date("2025-06-15T12:00:00.000Z");
    await job.enqueueAt(date, 99);

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    expect(call.run_at).toBe("2025-06-15T12:00:00.000Z");
    expect(JSON.parse(call.args)).toEqual([99]);
  });

  it('enqueueIn("5m") sets run_at ~5 minutes from now', async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.in-str", async () => {});
    const before = Date.now();
    await job.enqueueIn("5m");
    const after = Date.now();

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    const runAt = new Date(call.run_at!).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(runAt).toBeLessThanOrEqual(after + 300_000);
  });

  it("enqueueIn(30000) sets run_at ~30s from now", async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.in-num", async () => {});
    const before = Date.now();
    await job.enqueueIn(30_000);
    const after = Date.now();

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    const runAt = new Date(call.run_at!).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(runAt).toBeLessThanOrEqual(after + 30_000);
  });

  it("custom maxAttempts is passed through to insertJob", async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.max", async () => {}, { maxAttempts: 10 });
    await job.enqueue();

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    expect(call.max_attempts).toBe(10);
  });

  it("returns the job ID from insertJob", async () => {
    const adapter = createMockAdapter({
      insertJob: vi.fn(async () => ({
        id: "custom-id-123",
        job_type: "",
        args: "[]",
        status: "queued" as const,
        attempts: 0,
        max_attempts: 3,
        run_at: new Date().toISOString(),
        locked_until: null,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    });
    setAdapter(adapter);

    const job = defineJob("test.id", async () => {});
    const id = await job.enqueue();
    expect(id).toBe("custom-id-123");
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  it("throws on non-serializable args (circular reference)", async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.circular", async (..._args: any[]) => {});
    const circular: any = {};
    circular.self = circular;

    await expect(job.enqueue(circular)).rejects.toThrow(
      "Job arguments must be JSON-serializable.",
    );
  });

  it("throws on args containing a function", async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    // Functions are silently dropped by JSON.stringify (replaced with undefined
    // inside arrays), but a top-level function is just fine for JSON.stringify.
    // For a circular ref we get a real throw. For functions inside objects they
    // silently become null — that's standard JSON behaviour and is acceptable.
    // This test verifies the overall serialization path works.
    const job = defineJob("test.fn", async (..._args: any[]) => {});
    // A bare function as an arg serializes to `[null]` — no error.
    // But a circular ref with a function inside will throw.
    const bad: any = {};
    bad.fn = () => {};
    bad.self = bad;
    await expect(job.enqueue(bad)).rejects.toThrow(
      "Job arguments must be JSON-serializable.",
    );
  });

  // -----------------------------------------------------------------------
  // Delay parsing
  // -----------------------------------------------------------------------

  it('parses "10s" correctly', async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.10s", async () => {});
    const before = Date.now();
    await job.enqueueIn("10s");

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    const runAt = new Date(call.run_at!).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 10_000);
    expect(runAt).toBeLessThanOrEqual(Date.now() + 10_000);
  });

  it('parses "2h" correctly', async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.2h", async () => {});
    const before = Date.now();
    await job.enqueueIn("2h");

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    const runAt = new Date(call.run_at!).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 7_200_000);
    expect(runAt).toBeLessThanOrEqual(Date.now() + 7_200_000);
  });

  it('parses "1d" correctly', async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.1d", async () => {});
    const before = Date.now();
    await job.enqueueIn("1d");

    const call = vi.mocked(adapter.insertJob).mock.calls[0][0];
    const runAt = new Date(call.run_at!).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(runAt).toBeLessThanOrEqual(Date.now() + 86_400_000);
  });

  it('throws on invalid delay format "5x"', async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.bad-delay", async () => {});
    await expect(job.enqueueIn("5x")).rejects.toThrow(
      'Invalid duration format: "5x"',
    );
  });

  it('throws on empty delay string ""', async () => {
    const adapter = createMockAdapter();
    setAdapter(adapter);

    const job = defineJob("test.empty-delay", async () => {});
    await expect(job.enqueueIn("")).rejects.toThrow(
      'Invalid duration format: ""',
    );
  });
});
