import type { BackoffStrategy } from "../types.js";

export const DEFAULT_BASE_MS = 1_000;
export const DEFAULT_MAX_BACKOFF_MS = 3_600_000; // 1 hour

export function calculateBackoff(
  attempt: number,
  strategy: BackoffStrategy,
  baseMs: number = DEFAULT_BASE_MS,
  maxMs: number = DEFAULT_MAX_BACKOFF_MS,
): number {
  let delay: number;

  if (typeof strategy === "function") {
    delay = strategy(attempt);
  } else {
    switch (strategy) {
      case "exponential":
        delay = Math.pow(2, attempt) * baseMs;
        break;
      case "linear":
        delay = attempt * baseMs;
        break;
      case "fixed":
        delay = baseMs;
        break;
      default: {
        const _exhaustive: never = strategy;
        throw new Error(`Unknown backoff strategy: ${_exhaustive}`);
      }
    }
  }

  if (!Number.isFinite(delay)) {
    delay = baseMs;
  }

  return Math.min(Math.max(0, delay), maxMs);
}
