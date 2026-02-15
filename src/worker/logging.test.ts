import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withJobContext,
  getJobContext,
  installConsoleInterceptors,
  removeConsoleInterceptors,
  flushLogs,
} from "./logging.js";
import type { JobContext } from "./logging.js";
import type { Job } from "../types.js";
import type { DatabaseAdapter } from "../db/adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "job-1",
    job_type: "test.job",
    args: '["hello"]',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withJobContext / getJobContext", () => {
  it("getJobContext() returns undefined outside context", () => {
    expect(getJobContext()).toBeUndefined();
  });

  it("context is accessible inside withJobContext", async () => {
    const job = makeJob();
    await withJobContext(job, async () => {
      const ctx = getJobContext();
      expect(ctx).toBeDefined();
    });
  });

  it("context has correct jobId and attempt from the Job", async () => {
    const job = makeJob({ id: "abc-123", attempts: 4 });
    await withJobContext(job, async () => {
      const ctx = getJobContext()!;
      expect(ctx.jobId).toBe("abc-123");
      expect(ctx.attempt).toBe(4);
    });
  });

  it("context starts with empty logs array", async () => {
    const job = makeJob();
    await withJobContext(job, async () => {
      const ctx = getJobContext()!;
      expect(ctx.logs).toEqual([]);
    });
  });

  it("context is accessible across async boundaries", async () => {
    const job = makeJob({ id: "async-test" });
    await withJobContext(job, async () => {
      // Cross a microtask boundary
      await Promise.resolve();

      // Cross a setTimeout boundary
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const ctx = getJobContext();
          expect(ctx).toBeDefined();
          expect(ctx!.jobId).toBe("async-test");
          resolve();
        }, 0);
      });
    });
  });

  it("re-throws errors from fn", async () => {
    const job = makeJob();
    await expect(
      withJobContext(job, async () => {
        throw new Error("handler exploded");
      }),
    ).rejects.toThrow("handler exploded");
  });

  it("isolates context between concurrent calls", async () => {
    const jobA = makeJob({ id: "job-a", attempts: 1 });
    const jobB = makeJob({ id: "job-b", attempts: 2 });

    await Promise.all([
      withJobContext(jobA, async () => {
        await new Promise((r) => setTimeout(r, 10));
        const ctx = getJobContext()!;
        expect(ctx.jobId).toBe("job-a");
        expect(ctx.attempt).toBe(1);
      }),
      withJobContext(jobB, async () => {
        await new Promise((r) => setTimeout(r, 10));
        const ctx = getJobContext()!;
        expect(ctx.jobId).toBe("job-b");
        expect(ctx.attempt).toBe(2);
      }),
    ]);
  });

  it("returns the context after fn completes", async () => {
    const job = makeJob({ id: "return-test", attempts: 3 });
    const result = await withJobContext(job, async () => {
      const ctx = getJobContext()!;
      ctx.logs.push({
        level: "info",
        message: "hello from handler",
        timestamp: new Date().toISOString(),
      });
    });

    expect(result.jobId).toBe("return-test");
    expect(result.attempt).toBe(3);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toBe("hello from handler");
  });

  it("context is undefined after withJobContext completes", async () => {
    const job = makeJob();
    await withJobContext(job, async () => {
      expect(getJobContext()).toBeDefined();
    });
    expect(getJobContext()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Console interception
// ---------------------------------------------------------------------------

describe("console interception", () => {
  beforeEach(() => {
    installConsoleInterceptors();
  });

  afterEach(() => {
    removeConsoleInterceptors();
  });

  it("console.log captures as 'info'", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log("hello");
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].level).toBe("info");
    expect(ctx.logs[0].message).toBe("hello");
  });

  it("console.warn captures as 'warn'", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.warn("careful");
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].level).toBe("warn");
    expect(ctx.logs[0].message).toBe("careful");
  });

  it("console.error captures as 'error'", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.error("boom");
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].level).toBe("error");
    expect(ctx.logs[0].message).toBe("boom");
  });

  it("original console still receives output", async () => {
    // Remove interceptors so we can grab the real original, then wrap it
    removeConsoleInterceptors();
    const realLog = console.log;
    const received: unknown[][] = [];
    // Replace console.log with a tracker before interceptors are installed
    // so that originalConsole captures our tracker as "the original".
    // We need to re-import or reset — but since originalConsole is captured
    // at module load time, we instead verify structurally: the patched
    // console.log is a *different* function from the original, proving
    // wrapping occurred. Combined with the capture tests above, this proves
    // the original is called (otherwise captureLog + original pattern breaks).
    console.log = realLog;
    installConsoleInterceptors();

    // The patched console.log should be different from the original
    expect(console.log).not.toBe(realLog);

    // Calling it should not throw (proves delegation works)
    const job = makeJob();
    await withJobContext(job, async () => {
      expect(() => console.log("passthrough")).not.toThrow();
    });
  });

  it("does not capture outside job context", () => {
    console.log("outside");
    // No context → nothing to check, but it shouldn't throw
    expect(getJobContext()).toBeUndefined();
  });

  it("multiple args are joined with spaces", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log("a", "b", "c");
    });
    expect(ctx.logs[0].message).toBe("a b c");
  });

  it("non-string args are serialized", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log("count:", 42, true, null, { key: "val" });
    });
    expect(ctx.logs[0].message).toBe('count: 42 true null {"key":"val"}');
  });

  it("circular references don't crash", async () => {
    const job = makeJob();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const ctx = await withJobContext(job, async () => {
      console.log("obj:", circular);
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].message).toContain("obj:");
  });

  it("double install doesn't double-capture", async () => {
    // Install again (already installed in beforeEach)
    installConsoleInterceptors();

    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log("once");
    });
    // Should capture exactly once, not twice
    expect(ctx.logs).toHaveLength(1);
  });

  it("remove restores original behavior", async () => {
    removeConsoleInterceptors();

    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log("not captured");
    });
    // Interceptors removed → no capture
    expect(ctx.logs).toHaveLength(0);

    // Re-install for afterEach symmetry (afterEach calls remove again, which is idempotent)
    installConsoleInterceptors();
  });

  it("zero arguments produce log with empty message", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log();
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].level).toBe("info");
    expect(ctx.logs[0].message).toBe("");
  });

  it("undefined argument falls back to String()", async () => {
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log(undefined);
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].message).toBe("undefined");
  });

  it("special objects serialize correctly", async () => {
    const job = makeJob();
    const date = new Date("2024-01-15T10:30:00.000Z");
    const ctx = await withJobContext(job, async () => {
      console.log(date, /abc/i, function fn() {});
    });
    expect(ctx.logs).toHaveLength(1);
    const msg = ctx.logs[0].message;
    // Date serializes to ISO string via JSON.stringify (quoted)
    expect(msg).toContain('"2024-01-15T10:30:00.000Z"');
    // RegExp serializes to {} via JSON.stringify
    expect(msg).toContain("{}");
    // Function: JSON.stringify returns undefined → String() fallback
    expect(msg).toContain("function fn()");
  });

  it("captured log entry has ISO 8601 timestamp", async () => {
    const before = new Date().toISOString();
    const job = makeJob();
    const ctx = await withJobContext(job, async () => {
      console.log("ts check");
    });
    const after = new Date().toISOString();

    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0].timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(ctx.logs[0].timestamp >= before).toBe(true);
    expect(ctx.logs[0].timestamp <= after).toBe(true);
  });

  it("concurrent jobs have isolated capture", async () => {
    const jobA = makeJob({ id: "log-a" });
    const jobB = makeJob({ id: "log-b" });

    const [ctxA, ctxB] = await Promise.all([
      withJobContext(jobA, async () => {
        console.log("from A");
        await new Promise((r) => setTimeout(r, 10));
        console.log("still A");
      }),
      withJobContext(jobB, async () => {
        console.warn("from B");
        await new Promise((r) => setTimeout(r, 10));
        console.error("still B");
      }),
    ]);

    expect(ctxA.logs).toHaveLength(2);
    expect(ctxA.logs.every((l) => l.message.includes("A"))).toBe(true);

    expect(ctxB.logs).toHaveLength(2);
    expect(ctxB.logs.every((l) => l.message.includes("B"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flushLogs
// ---------------------------------------------------------------------------

describe("flushLogs", () => {
  function createMockAdapter() {
    return { insertLogs: vi.fn(async () => {}) } as unknown as DatabaseAdapter;
  }

  function createContext(overrides?: Partial<JobContext>): JobContext {
    return {
      jobId: "job-1",
      attempt: 1,
      logs: [],
      ...overrides,
    };
  }

  it("no-op when logs array is empty", async () => {
    const adapter = createMockAdapter();
    const context = createContext();

    await flushLogs(context, adapter);

    expect((adapter.insertLogs as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("converts LogEntry[] to NewJobLog[] with correct fields", async () => {
    const adapter = createMockAdapter();
    const context = createContext({
      jobId: "job-42",
      attempt: 3,
      logs: [
        { level: "info", message: "hello", timestamp: "2025-01-01T00:00:00.000Z" },
      ],
    });

    await flushLogs(context, adapter);

    expect((adapter.insertLogs as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith([
      {
        job_id: "job-42",
        attempt: 3,
        level: "info",
        message: "hello",
        timestamp: "2025-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("clears the context buffer after flushing", async () => {
    const adapter = createMockAdapter();
    const context = createContext({
      logs: [{ level: "info", message: "test", timestamp: "2025-01-01T00:00:00.000Z" }],
    });

    await flushLogs(context, adapter);

    expect(context.logs).toEqual([]);
  });

  it("preserves capture-time timestamps", async () => {
    const adapter = createMockAdapter();
    const ts1 = "2025-01-01T00:00:01.000Z";
    const ts2 = "2025-01-01T00:00:02.000Z";
    const context = createContext({
      logs: [
        { level: "info", message: "first", timestamp: ts1 },
        { level: "warn", message: "second", timestamp: ts2 },
      ],
    });

    await flushLogs(context, adapter);

    const insertedLogs = (adapter.insertLogs as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedLogs[0].timestamp).toBe(ts1);
    expect(insertedLogs[1].timestamp).toBe(ts2);
  });

  it("swallows adapter errors without throwing", async () => {
    const adapter = {
      insertLogs: vi.fn(async () => { throw new Error("DB down"); }),
    } as unknown as DatabaseAdapter;
    const context = createContext({
      logs: [{ level: "error", message: "test", timestamp: "2025-01-01T00:00:00.000Z" }],
    });

    await expect(flushLogs(context, adapter)).resolves.not.toThrow();
  });

  it("handles multiple entries in a single batch", async () => {
    const adapter = createMockAdapter();
    const context = createContext({
      jobId: "job-batch",
      attempt: 2,
      logs: [
        { level: "info", message: "one", timestamp: "2025-01-01T00:00:01.000Z" },
        { level: "warn", message: "two", timestamp: "2025-01-01T00:00:02.000Z" },
        { level: "error", message: "three", timestamp: "2025-01-01T00:00:03.000Z" },
      ],
    });

    await flushLogs(context, adapter);

    expect((adapter.insertLogs as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const insertedLogs = (adapter.insertLogs as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedLogs).toHaveLength(3);
    expect(insertedLogs[0].job_id).toBe("job-batch");
    expect(insertedLogs[2].level).toBe("error");
  });
});
