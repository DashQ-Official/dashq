import { describe, it, expect } from "vitest";
import { parseDuration } from "./utils.js";

describe("parseDuration", () => {
  it("returns a number as-is (milliseconds)", () => {
    expect(parseDuration(5000)).toBe(5000);
    expect(parseDuration(0)).toBe(0);
  });

  it('parses "s" (seconds)', () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  it('parses "m" (minutes)', () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  it('parses "h" (hours)', () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  it('parses "d" (days)', () => {
    expect(parseDuration("7d")).toBe(604_800_000);
  });

  it("throws on invalid string format", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration format");
    expect(() => parseDuration("5x")).toThrow("Invalid duration format");
    expect(() => parseDuration("")).toThrow("Invalid duration format");
    expect(() => parseDuration("m5")).toThrow("Invalid duration format");
  });
});
