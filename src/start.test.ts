import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DatabaseAdapter } from "./db/adapter.js";
import type { Worker } from "./worker/worker.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

const mockAdapter: DatabaseAdapter = {
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
};

const mockWorker: Worker = {
  start: vi.fn(),
  stop: vi.fn(async () => {}),
};

vi.mock("./db/create-adapter.js", () => ({
  createAdapter: vi.fn(() => mockAdapter),
}));

vi.mock("./worker/worker.js", () => ({
  createWorker: vi.fn(() => mockWorker),
}));

vi.mock("./worker/logging.js", () => ({
  installConsoleInterceptors: vi.fn(),
  removeConsoleInterceptors: vi.fn(),
}));

// Import after mocks
import { start } from "./start.js";
import { createAdapter } from "./db/create-adapter.js";
import { createWorker } from "./worker/worker.js";
import {
  installConsoleInterceptors,
  removeConsoleInterceptors,
} from "./worker/logging.js";
import { getAdapter, clearAdapter } from "./core/db-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.mocked(mockAdapter.initialize).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockAdapter.close).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockWorker.start).mockReset();
  vi.mocked(mockWorker.stop).mockReset().mockResolvedValue(undefined);
  vi.mocked(createAdapter).mockReset().mockReturnValue(mockAdapter);
  vi.mocked(createWorker).mockReset().mockReturnValue(mockWorker);
  vi.mocked(installConsoleInterceptors).mockReset();
  vi.mocked(removeConsoleInterceptors).mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("start()", () => {
  let handle: Awaited<ReturnType<typeof start>> | null = null;

  beforeEach(() => {
    resetMocks();
    handle = null;
  });

  afterEach(async () => {
    // Ensure clean state between tests
    if (handle) {
      await handle.stop();
      handle = null;
    }
    clearAdapter();
  });

  // =========================================================================
  // Lifecycle — defaults
  // =========================================================================

  it("initializes adapter, sets adapter, starts worker, and starts server", async () => {
    handle = await start({ database: ":memory:", port: 0 });

    expect(mockAdapter.initialize).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledOnce();
    expect(mockWorker.start).toHaveBeenCalledOnce();
    expect(installConsoleInterceptors).toHaveBeenCalledOnce();
    // adapter should be accessible via getAdapter()
    expect(getAdapter()).toBe(mockAdapter);
    // server should be running
    expect(handle.port).toBeGreaterThan(0);
  });

  // =========================================================================
  // dashboard: false
  // =========================================================================

  it("skips dashboard when dashboard: false", async () => {
    handle = await start({ database: ":memory:", dashboard: false });

    expect(handle.port).toBe(0);
    expect(mockWorker.start).toHaveBeenCalledOnce();
  });

  // =========================================================================
  // worker: false
  // =========================================================================

  it("skips worker and console interceptors when worker: false", async () => {
    handle = await start({ database: ":memory:", worker: false, port: 0 });

    expect(createWorker).not.toHaveBeenCalled();
    expect(mockWorker.start).not.toHaveBeenCalled();
    expect(installConsoleInterceptors).not.toHaveBeenCalled();
    // dashboard should still start
    expect(handle.port).toBeGreaterThan(0);
  });

  // =========================================================================
  // Both disabled
  // =========================================================================

  it("initializes only adapter when both worker and dashboard are false", async () => {
    handle = await start({
      database: ":memory:",
      worker: false,
      dashboard: false,
    });

    expect(mockAdapter.initialize).toHaveBeenCalledOnce();
    expect(createWorker).not.toHaveBeenCalled();
    expect(handle.port).toBe(0);
  });

  // =========================================================================
  // Worker with custom options
  // =========================================================================

  it("passes worker options through to createWorker", async () => {
    const workerOpts = { pollingInterval: 500, leaseTimeout: 60000 };
    handle = await start({
      database: ":memory:",
      worker: workerOpts,
      dashboard: false,
    });

    expect(createWorker).toHaveBeenCalledWith(mockAdapter, workerOpts);
  });

  // =========================================================================
  // Dashboard with custom basePath
  // =========================================================================

  it("passes basePath to dashboard plugin", async () => {
    handle = await start({
      database: ":memory:",
      worker: false,
      dashboard: { basePath: "/admin" },
      port: 0,
    });

    // Verify server is up and the basePath was used by hitting the API
    const port = handle.port;
    const res = await fetch(`http://localhost:${port}/admin/api/overview`);
    expect(res.status).toBe(200);
  });

  // =========================================================================
  // Port 0 — OS-assigned port
  // =========================================================================

  it("reports actual port when port 0 is used", async () => {
    handle = await start({
      database: ":memory:",
      worker: false,
      port: 0,
    });

    expect(handle.port).toBeGreaterThan(0);
  });

  // =========================================================================
  // stop() order
  // =========================================================================

  it("shuts down in correct order: interceptors, worker, server, adapter", async () => {
    const callOrder: string[] = [];

    vi.mocked(removeConsoleInterceptors).mockImplementation(() => {
      callOrder.push("removeInterceptors");
    });
    vi.mocked(mockWorker.stop).mockImplementation(async () => {
      callOrder.push("workerStop");
    });
    vi.mocked(mockAdapter.close).mockImplementation(async () => {
      callOrder.push("adapterClose");
    });

    handle = await start({ database: ":memory:", port: 0 });
    await handle.stop();
    handle = null; // already stopped

    expect(callOrder).toEqual([
      "removeInterceptors",
      "workerStop",
      // server.close is real Fastify — happens between worker and adapter
      "adapterClose",
    ]);
  });

  // =========================================================================
  // stop() idempotent
  // =========================================================================

  it("stop() is idempotent — second call is a no-op", async () => {
    handle = await start({
      database: ":memory:",
      dashboard: false,
      worker: false,
    });

    await handle.stop();
    await handle.stop(); // should not throw
    handle = null;

    expect(mockAdapter.close).toHaveBeenCalledOnce();
  });

  // =========================================================================
  // Double start() throws
  // =========================================================================

  it("throws if start() is called while already running", async () => {
    handle = await start({
      database: ":memory:",
      dashboard: false,
      worker: false,
    });

    await expect(
      start({ database: ":memory:", dashboard: false, worker: false }),
    ).rejects.toThrow("already started");
  });

  // =========================================================================
  // Restart after stop
  // =========================================================================

  it("allows restart after stop()", async () => {
    handle = await start({
      database: ":memory:",
      dashboard: false,
      worker: false,
    });
    await handle.stop();
    handle = null;

    // Should not throw
    handle = await start({
      database: ":memory:",
      dashboard: false,
      worker: false,
    });
  });

  // =========================================================================
  // Validation errors
  // =========================================================================

  it("throws on missing database", async () => {
    await expect(start({} as any)).rejects.toThrow("database");
  });

  it("throws on invalid port", async () => {
    await expect(start({ database: "x", port: -1 })).rejects.toThrow("port");
  });

  // =========================================================================
  // Signal handler cleanup
  // =========================================================================

  it("removes signal handlers after stop()", async () => {
    const baselineSigint = process.listenerCount("SIGINT");
    const baselineSigterm = process.listenerCount("SIGTERM");

    handle = await start({
      database: ":memory:",
      dashboard: false,
      worker: false,
    });

    expect(process.listenerCount("SIGINT")).toBe(baselineSigint + 1);
    expect(process.listenerCount("SIGTERM")).toBe(baselineSigterm + 1);

    await handle.stop();
    handle = null;

    expect(process.listenerCount("SIGINT")).toBe(baselineSigint);
    expect(process.listenerCount("SIGTERM")).toBe(baselineSigterm);
  });

  // =========================================================================
  // Partial failure cleanup
  // =========================================================================

  it("cleans up adapter if dashboard server fails to start", async () => {
    // Use a port that will fail (non-0 might collide, but we'll test differently)
    // Instead, mock the adapter to track that close is called on failure
    let closeCallCount = 0;
    vi.mocked(mockAdapter.close).mockImplementation(async () => {
      closeCallCount++;
    });

    // Start first instance on port 0 to grab an OS port
    handle = await start({
      database: ":memory:",
      worker: false,
      port: 0,
    });

    const usedPort = handle.port;

    // Second start should fail because module flag is set, so stop first
    await handle.stop();
    handle = null;
    closeCallCount = 0;

    // Now start on the same used port — it may or may not fail depending on
    // OS release timing. Instead, use a different approach: make server.listen fail
    // by providing an invalid host
    await expect(
      start({
        database: ":memory:",
        worker: false,
        host: "999.999.999.999",
        port: 0,
      }),
    ).rejects.toThrow();

    // Adapter should have been cleaned up
    expect(closeCallCount).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // handle.adapter
  // =========================================================================

  it("exposes the adapter on the handle", async () => {
    handle = await start({
      database: ":memory:",
      dashboard: false,
      worker: false,
    });

    expect(handle.adapter).toBe(mockAdapter);
  });
});
