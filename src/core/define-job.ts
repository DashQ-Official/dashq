/**
 * `defineJob()` — the primary developer-facing API.
 *
 * Registers a job handler with the registry and returns a `JobDefinition`
 * object with type-safe `.enqueue()`, `.enqueueAt()`, and `.enqueueIn()` methods.
 *
 * This function has no DB dependency — it can be called at module load time.
 * The enqueue methods require a DB adapter to be set via `start()`.
 */

import type { JobOptions, JobDefinition } from "../types.js";
import * as registry from "./registry.js";
import { getAdapter } from "./db-state.js";
import { parseDuration } from "../utils.js";

export function defineJob<TArgs extends any[]>(
  jobId: string,
  handler: (...args: TArgs) => Promise<void>,
  options?: JobOptions,
): JobDefinition<TArgs> {
  registry.register(jobId, handler, options);

  const { maxAttempts } = registry.getHandler(jobId)!.options;

  async function insertJob(args: TArgs, runAt: string): Promise<string> {
    const adapter = getAdapter();

    // Validate args are JSON-serializable
    try {
      JSON.stringify(args);
    } catch {
      throw new Error("Job arguments must be JSON-serializable.");
    }

    const job = await adapter.insertJob({
      job_type: jobId,
      args: JSON.stringify(args),
      max_attempts: maxAttempts,
      run_at: runAt,
    });

    return job.id;
  }

  return Object.freeze({
    jobId,

    enqueue(...args: TArgs): Promise<string> {
      return insertJob(args, new Date().toISOString());
    },

    enqueueAt(date: Date, ...args: TArgs): Promise<string> {
      return insertJob(args, date.toISOString());
    },

    async enqueueIn(delay: string | number, ...args: TArgs): Promise<string> {
      const ms = parseDuration(delay);
      const runAt = new Date(Date.now() + ms).toISOString();
      return insertJob(args, runAt);
    },
  });
}
