/**
 * Internal job registry — maps job type identifiers to handler functions
 * and their resolved options.
 *
 * Used by `defineJob()` at module load time and by the worker engine at
 * execution time. Has no database dependency.
 */

import type { BackoffStrategy, JobOptions, RegisteredJob } from "../types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF: BackoffStrategy = "exponential";

const registry = new Map<string, RegisteredJob>();

/**
 * Register a job handler with the given jobId and options.
 *
 * Throws if:
 * - `jobId` is empty or whitespace-only
 * - `jobId` is already registered
 * - `maxAttempts` is not a positive integer
 */
export function register(
  jobId: string,
  handler: (...args: any[]) => Promise<void>,
  options?: JobOptions,
): void {
  if (!jobId || jobId.trim() === "") {
    throw new Error("jobId must be a non-empty string");
  }

  if (registry.has(jobId)) {
    throw new Error(`Job "${jobId}" is already registered`);
  }

  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }

  const backoff = options?.backoff ?? DEFAULT_BACKOFF;

  registry.set(jobId, {
    jobId,
    handler,
    options: { maxAttempts, backoff },
  });
}

/** Look up a registered job by its jobId. Returns `undefined` if not found. */
export function getHandler(jobId: string): RegisteredJob | undefined {
  return registry.get(jobId);
}

/** Return an array of all registered job type identifiers. */
export function getAllJobTypes(): string[] {
  return Array.from(registry.keys());
}

/** Check whether a jobId is registered. */
export function has(jobId: string): boolean {
  return registry.has(jobId);
}

/** Clear all registrations. Intended for test isolation. */
export function clear(): void {
  registry.clear();
}
