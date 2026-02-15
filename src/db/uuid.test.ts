import { describe, it, expect } from "vitest";
import { generateId } from "./uuid.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateId", () => {
  describe("format", () => {
    it("returns a 36-character string", () => {
      expect(generateId()).toHaveLength(36);
    });

    it("matches UUIDv7 format", () => {
      expect(generateId()).toMatch(UUID_V7_RE);
    });

    it("has version 7", () => {
      expect(generateId()[14]).toBe("7");
    });

    it("has correct variant bits", () => {
      expect(["8", "9", "a", "b"]).toContain(generateId()[19]);
    });
  });

  describe("timestamp", () => {
    it("embeds the current timestamp in the first 48 bits", () => {
      const before = Date.now();
      const id = generateId();
      const after = Date.now();

      const hex = id.replace(/-/g, "").slice(0, 12);
      const embedded = parseInt(hex, 16);

      expect(embedded).toBeGreaterThanOrEqual(before);
      expect(embedded).toBeLessThanOrEqual(after);
    });
  });

  describe("time-sortability", () => {
    it("generates IDs that sort chronologically", () => {
      const id1 = generateId();
      // Wait for a new millisecond
      const target = Date.now() + 2;
      while (Date.now() < target) {
        /* wait */
      }
      const id2 = generateId();

      expect(id1 < id2).toBe(true);
    });
  });

  describe("uniqueness", () => {
    it("produces 10 000 unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(10_000);
    });
  });

  describe("monotonic ordering", () => {
    it("rapid-fire IDs are already in sorted order", () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(generateId());
      }
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });
  });
});
