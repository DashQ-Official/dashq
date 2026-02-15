/**
 * Polling utility to wait for a job to reach a terminal status.
 */

import type { DatabaseAdapter } from "../db/adapter.js";
import type { Job } from "../types.js";

export type WaitForJobOptions = {
  /** Polling interval in ms. Default: 500 */
  pollingInterval?: number;
  /** Max wait time in ms. Default: 30000 (30s) */
  timeout?: number;
};

export async function waitForJob(
  adapter: DatabaseAdapter,
  jobId: string,
  options?: WaitForJobOptions,
): Promise<Job> {
  const pollingInterval = options?.pollingInterval ?? 500;
  const timeout = options?.timeout ?? 30_000;
  const deadline = Date.now() + timeout;

  while (true) {
    const job = await adapter.getJob(jobId);

    if (job === null) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for job ${jobId} after ${timeout}ms (status: ${job.status})`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollingInterval));
  }
}
