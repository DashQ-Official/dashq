/**
 * Shared utility functions for DashQ.
 */

const DURATION_RE = /^(\d+)(s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration value into milliseconds.
 *
 * Accepts a number (already in ms) or a human-friendly string like
 * "5s", "10m", "2h", "7d".
 */
export function parseDuration(delay: string | number): number {
  if (typeof delay === "number") {
    return delay;
  }

  const match = DURATION_RE.exec(delay);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${delay}". Expected a number (ms) or a string like "5s", "5m", "1h", "1d".`,
    );
  }

  return Number(match[1]) * UNIT_MS[match[2]];
}
