import { describe, expect, it } from "vitest";
import {
  calculateBackoff,
  DEFAULT_BASE_MS,
  DEFAULT_MAX_BACKOFF_MS,
} from "./backoff.js";

describe("calculateBackoff", () => {
  describe("exponential strategy", () => {
    it("returns 2s for attempt 1", () => {
      expect(calculateBackoff(1, "exponential")).toBe(2_000);
    });

    it("returns 4s for attempt 2", () => {
      expect(calculateBackoff(2, "exponential")).toBe(4_000);
    });

    it("returns 8s for attempt 3", () => {
      expect(calculateBackoff(3, "exponential")).toBe(8_000);
    });

    it("returns 32s for attempt 5", () => {
      expect(calculateBackoff(5, "exponential")).toBe(32_000);
    });

    it("uses custom baseMs", () => {
      expect(calculateBackoff(2, "exponential", 500)).toBe(2_000);
    });
  });

  describe("linear strategy", () => {
    it("returns 1s for attempt 1", () => {
      expect(calculateBackoff(1, "linear")).toBe(1_000);
    });

    it("returns 3s for attempt 3", () => {
      expect(calculateBackoff(3, "linear")).toBe(3_000);
    });

    it("returns 10s for attempt 10", () => {
      expect(calculateBackoff(10, "linear")).toBe(10_000);
    });

    it("uses custom baseMs", () => {
      expect(calculateBackoff(3, "linear", 2_000)).toBe(6_000);
    });
  });

  describe("fixed strategy", () => {
    it("returns baseMs for attempt 1", () => {
      expect(calculateBackoff(1, "fixed")).toBe(1_000);
    });

    it("returns baseMs for attempt 5", () => {
      expect(calculateBackoff(5, "fixed")).toBe(1_000);
    });

    it("uses custom baseMs", () => {
      expect(calculateBackoff(1, "fixed", 5_000)).toBe(5_000);
    });
  });

  describe("custom function strategy", () => {
    it("calls the function with the attempt number", () => {
      const fn = (attempt: number) => attempt * 100;
      expect(calculateBackoff(3, fn)).toBe(300);
    });

    it("passes the correct attempt argument", () => {
      let receivedAttempt: number | undefined;
      const fn = (attempt: number) => {
        receivedAttempt = attempt;
        return 0;
      };
      calculateBackoff(7, fn);
      expect(receivedAttempt).toBe(7);
    });

    it("handles a function returning 0", () => {
      expect(calculateBackoff(1, () => 0)).toBe(0);
    });
  });

  describe("max delay cap", () => {
    it("caps exponential at default max", () => {
      // 2^30 * 1000 = ~1 billion ms, way over 1 hour
      expect(calculateBackoff(30, "exponential")).toBe(DEFAULT_MAX_BACKOFF_MS);
    });

    it("caps at custom maxMs", () => {
      expect(calculateBackoff(10, "exponential", 1_000, 5_000)).toBe(5_000);
    });

    it("does not cap when under max", () => {
      expect(calculateBackoff(2, "exponential")).toBe(4_000);
    });

    it("caps custom function result at max", () => {
      const fn = () => 999_999_999;
      expect(calculateBackoff(1, fn)).toBe(DEFAULT_MAX_BACKOFF_MS);
    });
  });

  describe("edge cases", () => {
    it("returns baseMs (1s) for attempt 0 with exponential (2^0 = 1)", () => {
      expect(calculateBackoff(0, "exponential")).toBe(1_000);
    });

    it("returns 0 for attempt 0 with linear", () => {
      expect(calculateBackoff(0, "linear")).toBe(0);
    });

    it("clamps negative custom function result to 0", () => {
      expect(calculateBackoff(1, () => -500)).toBe(0);
    });

    it("caps very large attempt with exponential", () => {
      expect(calculateBackoff(100, "exponential")).toBe(DEFAULT_MAX_BACKOFF_MS);
    });

    it("falls back to baseMs when custom function returns NaN", () => {
      expect(calculateBackoff(1, () => NaN)).toBe(DEFAULT_BASE_MS);
    });

    it("falls back to baseMs when custom function returns Infinity", () => {
      // Infinity is not finite, so falls back to baseMs, then clamped
      expect(calculateBackoff(1, () => Infinity)).toBe(DEFAULT_BASE_MS);
    });
  });

  describe("constants", () => {
    it("DEFAULT_BASE_MS is 1000", () => {
      expect(DEFAULT_BASE_MS).toBe(1_000);
    });

    it("DEFAULT_MAX_BACKOFF_MS is 3_600_000 (1 hour)", () => {
      expect(DEFAULT_MAX_BACKOFF_MS).toBe(3_600_000);
    });
  });
});
