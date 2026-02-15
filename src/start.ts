/**
 * start() — single entry point that wires all DashQ subsystems together:
 * database init, registry connection, worker, dashboard, and graceful shutdown.
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { StartOptions, DashQHandle } from "./config.js";
import { validateConfig, parseDatabaseConfig } from "./config.js";
import { createAdapter } from "./db/create-adapter.js";
import type { DatabaseAdapter } from "./db/adapter.js";
import { setAdapter, clearAdapter } from "./core/db-state.js";
import { createWorker } from "./worker/worker.js";
import type { Worker } from "./worker/worker.js";
import {
  installConsoleInterceptors,
  removeConsoleInterceptors,
} from "./worker/logging.js";
import { createDashboardPlugin } from "./dashboard/plugin.js";
import type { WorkerOptions, RetentionOptions } from "./types.js";
import { createCleanupScheduler } from "./cleanup.js";
import type { CleanupScheduler } from "./cleanup.js";

// ---------------------------------------------------------------------------
// Module-level guard
// ---------------------------------------------------------------------------

let started = false;

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

export async function start(options: StartOptions): Promise<DashQHandle> {
  if (started) {
    throw new Error("DashQ is already started. Call stop() before starting again.");
  }

  validateConfig(options);

  const dbConfig = parseDatabaseConfig(options.database);
  const adapter: DatabaseAdapter = createAdapter(dbConfig);

  // Track what has been initialized for partial-failure cleanup
  let adapterInitialized = false;
  let adapterConnected = false;
  let interceptorsInstalled = false;
  let worker: Worker | null = null;
  let server: FastifyInstance | null = null;
  let cleanup: CleanupScheduler | null = null;

  try {
    await adapter.initialize();
    adapterInitialized = true;

    setAdapter(adapter);
    adapterConnected = true;

    // Worker
    if (options.worker !== false) {
      installConsoleInterceptors();
      interceptorsInstalled = true;

      const workerOpts: WorkerOptions =
        typeof options.worker === "object" ? options.worker : {};
      worker = createWorker(adapter, workerOpts);
      worker.start();
    }

    // Dashboard
    if (options.dashboard !== false) {
      const dashOpts =
        typeof options.dashboard === "object" ? options.dashboard : {};
      server = Fastify();
      await server.register(createDashboardPlugin, {
        adapter,
        basePath: dashOpts.basePath,
      });
      await server.listen({
        port: options.port ?? 3000,
        host: options.host ?? "localhost",
      });
    }
    // Cleanup scheduler
    if (options.retention !== false) {
      const retentionOpts: RetentionOptions =
        typeof options.retention === "object" ? options.retention : {};
      cleanup = createCleanupScheduler(adapter, retentionOpts);
      cleanup.start();
    }
  } catch (error) {
    // Partial cleanup on failure
    if (cleanup) cleanup.stop();
    if (interceptorsInstalled) removeConsoleInterceptors();
    if (worker) await worker.stop();
    if (server) await server.close();
    if (adapterConnected) clearAdapter();
    if (adapterInitialized) await adapter.close();
    throw error;
  }

  // Resolve actual port
  const actualPort = server
    ? (server.addresses()[0]?.port ?? 0)
    : 0;

  // Shutdown state
  let stopping = false;

  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;

    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);

    if (cleanup) cleanup.stop();
    if (interceptorsInstalled) removeConsoleInterceptors();
    if (worker) await worker.stop();
    if (server) await server.close();
    clearAdapter();
    await adapter.close();

    started = false;
  }

  function onSignal() {
    stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  started = true;

  return {
    stop,
    cleanup: cleanup
      ? () => cleanup!.runOnce()
      : async () => ({ jobsDeleted: 0, logsDeleted: 0 }),
    get port() {
      return actualPort;
    },
    get adapter() {
      return adapter;
    },
  };
}
